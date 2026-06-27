'use strict';
/**
 * trace.js — behavioral token-waste diagnosis from REAL session transcripts (Lever 3, behavioral).
 *
 * The dynamic counterpart to the static `review`: where review grades the .claude/ design, `trace`
 * measures what a session actually WASTED — action loops, retry streaks — that a static review can't
 * see. Deterministic (no LLM); consumes scan's event stream (the single JSONL coupling point).
 *
 * Waste model (token-diet-native, NOT the academic coefficient-weighted WCR):
 *   introduced(e) = the tool-output tokens a redundant call added              (MEASURED)
 *   resend(e)     = 1 + turns it persists until the next COMPACTION boundary   (its cache_read re-send)
 *                   (compaction detected as a sharp cache_read drop)
 *   effective(e)  = introduced(e) × resend(e)
 *   waste_ratio   = Σ effective / session token volume
 * Real tokens + the compounding cache-read cost (the academic formula counts tokens once; we count
 * the re-sends, which is the dominant cost). Loops/retries are MEASURED.
 */
const { scanAll } = require('./scan');

// ── tunables (maintainer-only; calibrate as real trace data accrues) ──
const LOOP_MIN          = 3;     // ≥3 consecutive fuzzy-identical calls = a loop
const RETRY_MIN         = 2;     // ≥2 consecutive error results = a retry streak
const RESULT_NEAR_PCT   = 0.10;  // loop gate: results within ±10% tokens count as "same result" (else it's progress)
const COMPACT_DROP_PCT  = 0.40;  // cache_read dropping >40% vs the prior call = a compaction boundary
const COMPACT_FLOOR     = 2000;  // ignore drops when the prior cache_read was tiny (noise)
// Calibrated against real Claude Code sessions: actual compaction drops are sharp (>50% of cache_read),
// so 40% catches them with margin while ignoring normal turn-to-turn cache jitter. eff is thereby
// bounded by real compaction boundaries (~every 80–90 calls), not run to session end.

// ── fuzzy arg signature ─────────────────────────────────────────────────────────
// Aggressive normalization = the "fuzzy" match: whitespace/case/standalone-digit differences collapse,
// so `Read foo.js` at different ranges, or `npm test` run twice, share a signature.
function normalize(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ').trim();
}
function argSignature(name, input) {
  input = input || {};
  if (name === 'Bash' || name === 'PowerShell') return name + ':' + normalize(input.command);
  if (input.file_path || input.path)            return name + ':' + normalize(input.file_path || input.path);
  if (input.pattern)                            return name + ':' + normalize(input.pattern) + ':' + normalize(input.path || input.glob || '');
  // fall back to a stable digest of the input keys+values
  return name + ':' + normalize(Object.keys(input).sort().map(k => k + '=' + JSON.stringify(input[k])).join('&'));
}

// ── build the ordered event stream for one session ──────────────────────────────
// records: this session's per-call records (transcript order). meta: scan fileMeta for the session.
function buildEvents(records, meta) {
  meta = meta || {};
  const byId = meta.toolCallsById instanceof Map ? meta.toolCallsById : new Map(Object.entries(meta.toolCallsById || {}));
  const resultById = new Map();
  for (const r of (meta.toolResults || [])) resultById.set(r.tool_use_id, r);
  const events = [];
  records.forEach((rec, recIdx) => {
    for (const tc of (rec.toolCalls || [])) {
      const full = byId.get(tc.id) || {};
      const res  = resultById.get(tc.id) || {};
      events.push({
        recIdx,
        tool:   tc.name || full.name || '',
        sig:    argSignature(tc.name || full.name || '', full.input),
        resultTokens: res.result_tokens || 0,
        isError: res.is_error === true,
        cacheRead: rec.cacheRead || 0,
      });
    }
  });
  return events;
}

const nearSame = (a, b) => Math.abs(a - b) <= Math.max(1, Math.max(a, b)) * RESULT_NEAR_PCT;

// Mutating tools are EXCLUDED from loop detection: repeating Edit/Write is legitimate iterative work,
// not redundancy (and they return a same-size confirmation regardless of what changed, so the
// result-gate can't tell progress from a loop). Loops only count idempotent/retrieval actions —
// repeating a Read/Grep with the same result is genuine waste. (Retry-streak detection still covers all tools.)
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Update', 'Create',
  'TaskUpdate', 'TaskCreate', 'TodoWrite', 'TaskStop']);   // task/todo tools mutate state — repetition is progress

// ── detectors (pure) ────────────────────────────────────────────────────────────
// Loop: ≥LOOP_MIN consecutive same-sig calls whose results are near-identical (so genuine progress,
// where each call returns something new, is NOT flagged as a loop).
function detectLoops(events) {
  const loops = [];
  let i = 0;
  while (i < events.length) {
    if (MUTATING_TOOLS.has(events[i].tool)) { i++; continue; }   // edits/writes aren't loops — they're progress
    let j = i + 1;
    while (j < events.length && events[j].sig === events[i].sig &&
           (nearSame(events[j].resultTokens, events[i].resultTokens) || events[j].isError === events[i].isError && events[i].isError)) {
      j++;
    }
    const count = j - i;
    if (count >= LOOP_MIN) loops.push({ start: i, end: j - 1, count, tool: events[i].tool, sig: events[i].sig });
    i = (j > i + 1) ? j : i + 1;
  }
  return loops;
}

// Retry streak: ≥RETRY_MIN consecutive error results.
function detectRetries(events) {
  const streaks = [];
  let i = 0;
  while (i < events.length) {
    if (!events[i].isError) { i++; continue; }
    let j = i + 1;
    while (j < events.length && events[j].isError) j++;
    const count = j - i;
    if (count >= RETRY_MIN) streaks.push({ start: i, end: j - 1, count, tool: events[i].tool });
    i = j;
  }
  return streaks;
}

// Compaction boundaries: record indices where cache_read drops sharply (context was summarized/truncated).
function detectCompactions(records) {
  const idx = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].cacheRead || 0, cur = records[i].cacheRead || 0;
    if (prev >= COMPACT_FLOOR && cur < prev * (1 - COMPACT_DROP_PCT)) idx.push(i);
  }
  return idx;
}

// Context pressure (Lever 3 / cadence): a session that ran with cache_read near its max for most of
// the run held a near-full context the whole time — the re-sending baseline at its most expensive.
const PRESSURE_FLOOR = 100000;   // max cache_read must exceed this to count as "large context"
function detectContextPressure(records) {
  const cr = records.map(r => r.cacheRead || 0);
  const maxCR = cr.length ? Math.max(...cr) : 0;
  const nearFull = cr.filter(x => x > maxCR * 0.8).length;
  const compactions = detectCompactions(records).length;
  const heavy = maxCR > PRESSURE_FLOOR && nearFull > records.length * 0.5;
  return { maxCR, nearFull, compactions, calls: records.length, heavy };
}

// turns a waste event's tokens persist (re-sent as cache_read) before the next compaction or session end.
function resendTurns(recIdx, totalRecords, compactions) {
  const next = compactions.find(c => c > recIdx);
  return (next != null ? next : totalRecords) - recIdx - 1;   // # of later calls that re-send it
}

// ── Detector 2: delegation-fit (Lever 1, bidirectional) ─────────────────────────
// Verbose output from these in the MAIN session is the canonical "should be a subagent" case —
// the subagent isolates the verbose I/O and returns only a summary (Anthropic's own guidance).
const DELEGATABLE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch']);
const EXPLORE_MIN          = 3;      // ≥3 consecutive delegatable calls = an exploration cluster (not a single needed read)
const EXPLORE_TOKENS_MIN   = 4000;   // a cluster must dump at least this much output to be worth isolating
const SUMMARY_RATIO        = 0.15;   // PROJECTED: a subagent returns ~15% of the raw cluster output as a summary
const OVER_DELEGATE_CALLS  = 3;      // a subagent doing ≤ this many calls likely didn't earn its spawn tax
const ESTABLISH_TAX        = 20000;  // ~per-subagent context establishment cost (Anthropic / Claude Code)

// Returns { under:[{calls:[a,b],count,tokens,saved}], over:[{calls,outputTokens}], underProjected, overTax }.
// under = an EXPLORATION CLUSTER in MAIN (≥3 consecutive retrieval calls dumping >4k tokens) that a
// subagent should have isolated — a single needed read is NOT flagged. saved = the DIRECT main-context
// reduction (cluster output minus the ~15% summary); it also re-sends every turn (compounding), noted
// separately rather than multiplied into a misleading headline. over = a tiny subagent (~20k tax unrecovered).
function detectDelegation(events, records, kind) {
  if (kind === 'subagent') {
    const out = events.reduce((s, e) => s + e.resultTokens, 0);
    if (events.length <= OVER_DELEGATE_CALLS && out < EXPLORE_TOKENS_MIN)
      return { under: [], over: [{ calls: events.length, outputTokens: out }], underProjected: 0, overTax: ESTABLISH_TAX };
    return { under: [], over: [], underProjected: 0, overTax: 0 };
  }
  const under = []; let projected = 0;
  let i = 0;
  while (i < events.length) {
    if (!DELEGATABLE_TOOLS.has(events[i].tool)) { i++; continue; }
    let j = i, tokens = 0;
    while (j < events.length && DELEGATABLE_TOOLS.has(events[j].tool)) { tokens += events[j].resultTokens; j++; }
    const count = j - i;
    if (count >= EXPLORE_MIN && tokens > EXPLORE_TOKENS_MIN) {
      const saved = Math.round(tokens * (1 - SUMMARY_RATIO));   // direct: this much wouldn't have entered main
      projected += saved;
      under.push({ calls: [events[i].recIdx, events[j - 1].recIdx], count, tokens, saved });
    }
    i = j > i ? j : i + 1;
  }
  return { under, over: [], underProjected: projected, overTax: 0 };
}

// ── waste computation (compounding-aware) ───────────────────────────────────────
function computeWaste(events, records, loops, retries) {
  const compactions = detectCompactions(records);
  const totalRecords = records.length;
  let wasteRaw = 0, wasteEffective = 0;
  const items = [];
  const addEvent = (kind, e, label) => {
    const introduced = e.resultTokens;
    const resend = 1 + resendTurns(e.recIdx, totalRecords, compactions);
    const effective = introduced * resend;
    wasteRaw += introduced; wasteEffective += effective;
    return { introduced, resend, effective };
  };
  for (const lp of loops) {
    let raw = 0, eff = 0;
    for (let k = lp.start + 1; k <= lp.end; k++) { const w = addEvent('loop', events[k]); raw += w.introduced; eff += w.effective; }   // keep the first call; reps 2..N are waste
    items.push({ kind: 'loop', tool: lp.tool, count: lp.count, turns: [events[lp.start].recIdx, events[lp.end].recIdx], raw, effective: eff });
  }
  for (const rt of retries) {
    let raw = 0, eff = 0;
    for (let k = rt.start + 1; k <= rt.end; k++) { const w = addEvent('retry', events[k]); raw += w.introduced; eff += w.effective; }  // first failure is a legit attempt; re-failures are waste
    items.push({ kind: 'retry', tool: rt.tool, count: rt.count, turns: [events[rt.start].recIdx, events[rt.end].recIdx], raw, effective: eff });
  }
  const sessionTotal = records.reduce((s, r) => s + (r.input || 0) + (r.cacheWrite || 0) + (r.cacheRead || 0) + (r.output || 0), 0);
  const wasteRatio = sessionTotal > 0 ? wasteEffective / sessionTotal : 0;
  return { items, wasteRaw, wasteEffective, wasteRatio, sessionTotal, compactions: compactions.length };
}

// Pure end-to-end for one session's records+meta → waste report.
function analyzeSession(records, meta) {
  const events = buildEvents(records, meta);
  const loops = detectLoops(events);
  const retries = detectRetries(events);
  const kind = records.length ? (records[0].sessionKind || 'session') : 'session';
  const delegation = detectDelegation(events, records, kind);
  const pressure = detectContextPressure(records);
  return { ...computeWaste(events, records, loops, retries), delegation, pressure, calls: events.length };
}

// ── CLI: scan real sessions → per-session behavioral-waste report ───────────────
const path = require('path');
const fmt = n => Math.round(n).toLocaleString('en-US');
const shortLabel = f => path.basename(String(f), '.jsonl').slice(0, 18);

// Scan + analyze every session in the window (shared by runTrace and traceSummary — DRY).
async function collectSessions(opts = {}) {
  const days = opts.days != null ? +opts.days : 7;
  const { records, fileMeta } = await scanAll({ days, project: opts.project || null });
  const byFile = new Map();
  for (const r of records) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
  const all = [];
  for (const [file, recs] of byFile) {
    const meta = (fileMeta && fileMeta.get) ? (fileMeta.get(file) || {}) : {};
    all.push({ file, kind: recs[0].sessionKind || 'session', ...analyzeSession(recs, meta) });
  }
  return { days, all };
}

// Compact aggregates for the auto-mode / savings surface (no printing).
async function traceSummary(opts = {}) {
  const { days, all } = await collectSessions(opts);
  let measuredEff = 0, projectedDelegation = 0, overCount = 0, flagged = 0;
  for (const s of all) {
    if (s.items.length || s.delegation.under.length || s.delegation.over.length) flagged++;
    measuredEff += s.wasteEffective;
    projectedDelegation += s.delegation.underProjected;
    overCount += s.delegation.over.length;
  }
  return { days, sessions: flagged, measuredEff, projectedDelegation, overCount };
}

async function runTrace(opts = {}) {
  const { days, all } = await collectSessions(opts);
  if (!all.length) {
    console.log('\nNo session activity in the window. Use Claude Code, then re-run trace.\n');
    return;
  }
  const sessions = all.filter(s => s.items.length || s.delegation.under.length || s.delegation.over.length || s.pressure.heavy)
                      .sort((x, y) => y.wasteEffective - x.wasteEffective);
  const measured = sessions.filter(s => s.items.length);

  const total = sessions.reduce((s, x) => ({ raw: s.raw + x.wasteRaw, eff: s.eff + x.wasteEffective }), { raw: 0, eff: 0 });

  if (opts.json) {
    console.log(JSON.stringify({
      sessions: sessions.map(s => ({ session: shortLabel(s.file), kind: s.kind, calls: s.calls,
        measured: { wasteRaw: s.wasteRaw, wasteEffective: s.wasteEffective, items: s.items },
        projected: { delegationUnder: s.delegation.underProjected, under: s.delegation.under, over: s.delegation.over } })),
      total,
    }, null, 2));
    return;
  }

  console.log(`\n=== token-diet trace — behavioral waste (last ${days}d) ===`);

  // ── MEASURED: loops + retries (Lever 3) ──
  if (measured.length) {
    console.log('  MEASURED — loops + retries (Lever 3), re-sent through cache_read until compaction.');
    console.log('  raw = introduced once · eff = compounded re-send cost · re-send = the eff/raw multiplier.\n');
    console.log('  session            | kind     | calls |    raw |     eff | re-send');
    console.log('  -------------------+----------+-------+--------+---------+--------');
    for (const s of measured) {
      const mult = s.wasteRaw > 0 ? '×' + Math.round(s.wasteEffective / s.wasteRaw) : '-';
      console.log(`  ${shortLabel(s.file).padEnd(18)} | ${s.kind.slice(0, 8).padEnd(8)} | ${String(s.calls).padStart(5)} | ${fmt(s.wasteRaw).padStart(6)} | ${fmt(s.wasteEffective).padStart(7)} | ${mult.padStart(7)}`);
    }
    const top = measured.flatMap(s => s.items.map(it => ({ ...it, sess: shortLabel(s.file) }))).sort((a, b) => b.effective - a.effective).slice(0, 6);
    console.log('  top:');
    for (const it of top)
      console.log(`   [${it.kind}] ${it.sess}: ${it.tool} ×${it.count} (calls ${it.turns[0]}–${it.turns[1]}) — ${fmt(it.raw)} raw / ${fmt(it.effective)} eff`);
  } else {
    console.log('  MEASURED — loops + retries (Lever 3): none. Behaviorally lean on the measured axis.');
  }

  // ── PROJECTED: delegation-fit (Lever 1, bidirectional) ──
  const underRuns  = sessions.flatMap(s => s.delegation.under.map(u => ({ ...u, sess: shortLabel(s.file) }))).sort((a, b) => b.saved - a.saved);
  const overSess   = sessions.filter(s => s.delegation.over.length);
  const underTotal = sessions.reduce((s, x) => s + (x.delegation.underProjected || 0), 0);
  if (underRuns.length || overSess.length) {
    console.log('\n  PROJECTED — delegation-fit (Lever 1). saved = direct main-context reduction (a subagent');
    console.log('  returns ~15% of the cluster); it ALSO re-sends every turn, so the compounded cost is larger.');
    for (const u of underRuns.slice(0, 6))
      console.log(`   [under] ${u.sess}: exploration cluster (calls ${u.calls[0]}–${u.calls[1]}, ${u.count} retrieval calls, ${fmt(u.tokens)} tok) → delegate, save ~${fmt(u.saved)}`);
    for (const s of overSess.slice(0, 4))
      console.log(`   [over]  ${shortLabel(s.file)}: subagent did ${s.delegation.over[0].calls} call(s) — ~20k spawn tax likely unrecovered`);
    if (underTotal) console.log(`   → ~${fmt(underTotal)} projected tokens recoverable by isolating verbose exploration in subagents.`);
  }

  // ── CONTEXT PRESSURE (cadence) ──
  const pressured = sessions.filter(s => s.pressure.heavy);
  if (pressured.length) {
    console.log('\n  CONTEXT PRESSURE — sessions that held a near-full context most of the run (the re-sending baseline at its worst):');
    for (const s of pressured.slice(0, 5))
      console.log(`   ${shortLabel(s.file)}: ${s.pressure.calls} calls, cache_read peaked ~${fmt(s.pressure.maxCR)}, near-full for ${Math.round(100 * s.pressure.nearFull / s.pressure.calls)}% of the run, ${s.pressure.compactions} compaction(s)`);
    console.log('   → the fix is structural (Levers 5/6/8: shrink the always-loaded baseline), not behavioral.');
  }

  console.log('\n  Measured (Lever 3) and projected (Lever 1) are reported separately — never summed (attribution rule).\n');
}

module.exports = {
  LOOP_MIN, RETRY_MIN, RESULT_NEAR_PCT, COMPACT_DROP_PCT, MUTATING_TOOLS,
  DELEGATABLE_TOOLS, EXPLORE_MIN, EXPLORE_TOKENS_MIN, SUMMARY_RATIO, OVER_DELEGATE_CALLS,
  normalize, argSignature, buildEvents, detectLoops, detectRetries, detectCompactions,
  detectDelegation, detectContextPressure, resendTurns, computeWaste, analyzeSession,
  collectSessions, traceSummary, runTrace,
};

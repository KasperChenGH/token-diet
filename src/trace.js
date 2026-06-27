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
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Update', 'Create']);

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

// turns a waste event's tokens persist (re-sent as cache_read) before the next compaction or session end.
function resendTurns(recIdx, totalRecords, compactions) {
  const next = compactions.find(c => c > recIdx);
  return (next != null ? next : totalRecords) - recIdx - 1;   // # of later calls that re-send it
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
  return { ...computeWaste(events, records, loops, retries), calls: events.length };
}

// ── CLI: scan real sessions → per-session behavioral-waste report ───────────────
const path = require('path');
const fmt = n => Math.round(n).toLocaleString('en-US');
const shortLabel = f => path.basename(String(f), '.jsonl').slice(0, 18);

async function runTrace(opts = {}) {
  const days = opts.days != null ? +opts.days : 7;
  const { records, fileMeta } = await scanAll({ days, project: opts.project || null });
  if (!records.length) {
    console.log('\nNo session activity in the window. Use Claude Code, then re-run `token-diet trace`.\n');
    return;
  }
  const byFile = new Map();
  for (const r of records) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }

  const sessions = [];
  for (const [file, recs] of byFile) {
    const meta = (fileMeta && fileMeta.get) ? fileMeta.get(file) : null;
    const a = analyzeSession(recs, meta || {});
    if (a.items.length) sessions.push({ file, kind: recs[0].sessionKind || 'session', ...a });
  }
  sessions.sort((x, y) => y.wasteEffective - x.wasteEffective);

  const total = sessions.reduce((s, x) => ({ raw: s.raw + x.wasteRaw, eff: s.eff + x.wasteEffective }), { raw: 0, eff: 0 });

  if (opts.json) {
    console.log(JSON.stringify({
      sessions: sessions.map(s => ({ session: shortLabel(s.file), kind: s.kind, calls: s.calls,
        wasteRaw: s.wasteRaw, wasteEffective: s.wasteEffective, wasteRatio: +s.wasteRatio.toFixed(4), items: s.items })),
      total,
    }, null, 2));
    return;
  }

  console.log(`\n=== token-diet trace — behavioral waste (last ${days}d) ===`);
  console.log('  MEASURED: action loops + retry streaks, re-sent through cache_read until compaction.');
  console.log('  raw = tokens introduced once · eff = compounded re-send cost (the real bill).\n');
  if (!sessions.length) {
    console.log('  No loops or retry streaks detected — these sessions are behaviorally lean.\n');
    return;
  }
  console.log('  session            | kind     | calls |    raw |     eff | ratio');
  console.log('  -------------------+----------+-------+--------+---------+------');
  for (const s of sessions) {
    console.log(`  ${shortLabel(s.file).padEnd(18)} | ${s.kind.slice(0, 8).padEnd(8)} | ${String(s.calls).padStart(5)} | ${fmt(s.wasteRaw).padStart(6)} | ${fmt(s.wasteEffective).padStart(7)} | ${((s.wasteRatio * 100).toFixed(1) + '%').padStart(5)}`);
  }
  console.log(`\n  ${fmt(total.eff)} tokens of compounded waste across ${sessions.length} session(s) (raw ${fmt(total.raw)}).`);

  // top offending events
  const allItems = sessions.flatMap(s => s.items.map(it => ({ ...it, sess: shortLabel(s.file) }))).sort((a, b) => b.effective - a.effective).slice(0, 8);
  console.log('\n  Top waste events:');
  for (const it of allItems) {
    const what = it.kind === 'loop' ? `loop ${it.tool} ×${it.count}` : `retry ${it.tool} ×${it.count}`;
    console.log(`   [${it.kind}] ${it.sess}: ${what} (calls ${it.turns[0]}–${it.turns[1]}) — ${fmt(it.raw)} raw / ${fmt(it.effective)} eff tok`);
  }
  console.log('\n  Loops/retries → Lever 3 (evict redundant compute). For projected savings + design fixes, run `token-diet plan`.\n');
}

module.exports = {
  LOOP_MIN, RETRY_MIN, RESULT_NEAR_PCT, COMPACT_DROP_PCT, MUTATING_TOOLS,
  normalize, argSignature, buildEvents, detectLoops, detectRetries, detectCompactions,
  resendTurns, computeWaste, analyzeSession, runTrace,
};

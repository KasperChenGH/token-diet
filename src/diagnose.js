'use strict';
/**
 * diagnose.js — heuristic diagnosis of token waste patterns
 *
 * Seven heuristics, each mapped to an actionable lever:
 *
 * 1. HOT FILES      (Lever 5) — files Read >= 4 times → consolidate/cache
 * 2. LOW-RATIO AGENTS (Lever 1/7) — agents with ratio < 0.15 + their hot files
 * 3. TURNY SESSIONS (cache mechanics) — sessions with > 150 calls
 * 4. IDLE BABYSITTING (Lever 3) — sessions with > 15 min of idle time
 *    (gap > 5 min between consecutive assistant timestamps)
 * 5. MODEL MIX      (Lever 7) — opus share of output tokens; warn if > 80%
 *    when subagent files also exist
 * 6. SESSION DENSITY (Lever 2) — sessions-per-day (informational)
 * 7. TOOL OUTPUT BLOAT (Lever 8) — cache-read-amplified cost of large tool results
 */

const path     = require('path');
const fs       = require('fs');
const { scanAll } = require('./scan');

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function padL(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }
function hline(ws) { return ws.map(w => '-'.repeat(w)).join('-+-'); }

function resendProjection(amplified, cacheRead) {
  const multiplier = cacheRead > 0 ? amplified / cacheRead : 0;
  const absolute = Math.round(amplified);
  return {
    multiplier: +multiplier.toFixed(1),
    absolute,
    cacheRead,
    label: `≈${multiplier.toFixed(1)}× re-send projection (+${absolute.toLocaleString('en-US')} tokens vs cache_read baseline)`,
  };
}

// ── Lever 8 helper ────────────────────────────────────────────────────────────
// Derive a human-readable source key from a tool_use record.
//   Bash   → first token of input.command (the program name, path-stripped)
//   Read   → "Read:" + basename(file_path)
//   other  → tool name
//   no match → "unmatched"
function deriveSourceKey(toolCall) {
  if (!toolCall) return 'unmatched';
  const { name, input } = toolCall;
  if (name === 'Bash' || name === 'bash') {
    const cmd = (input && input.command) || '';
    const firstToken = cmd.trimStart().split(/\s+/)[0];
    if (!firstToken) return 'bash:other';
    // strip path separators so "/usr/bin/python" → "python"
    const prog = firstToken.replace(/.*[/\\]/, '');
    return prog || 'bash:other';
  }
  if (name === 'Read' || name === 'read') {
    const fp = (input && (input.file_path || input.path)) || '';
    const base = fp ? path.basename(fp) : '';
    return base ? `Read:${base}` : 'Read:?';
  }
  return name || 'unmatched';
}

async function runDiagnose(opts = {}) {
  const { records, fileMeta } = await scanAll(opts);

  if (records.length === 0) {
    console.log('No records found for the given filters.');
    console.log('  Try `token-diet review --dir .` for a zero-history grade, or widen with --days N / check --project.');
    return;
  }

  // ── Pre-aggregate per file ───────────────────────────────────────────────
  const fileMap = {};
  for (const r of records) {
    if (!fileMap[r.file]) {
      fileMap[r.file] = {
        file:        r.file,
        sessionKind: r.sessionKind,
        calls:       0,
        fresh_in:    0,
        cache_write: 0,
        cache_read:  0,
        output:      0,
        timestamps:  [],
        readFiles:   {},      // file_path -> count
      };
    }
    const f = fileMap[r.file];
    f.calls       += 1;
    f.fresh_in    += r.input;
    f.cache_write += r.cacheWrite;
    f.cache_read  += r.cacheRead;
    f.output      += r.output;
    if (r.timestamp) f.timestamps.push({ ts: Date.parse(r.timestamp), raw: r.timestamp });

    for (const tc of r.toolCalls) {
      if (tc.name === 'Read' && tc.filePath) {
        f.readFiles[tc.filePath] = (f.readFiles[tc.filePath] || 0) + 1;
      }
    }
  }

  const files = Object.values(fileMap);

  // ── HEURISTIC 1: HOT FILES (Lever 5) ────────────────────────────────────
  const globalReads = {};
  for (const f of files) {
    for (const [fp, cnt] of Object.entries(f.readFiles)) {
      globalReads[fp] = (globalReads[fp] || 0) + cnt;
    }
  }

  const hotFiles = Object.entries(globalReads)
    .filter(([, cnt]) => cnt >= 4)
    .sort((a, b) => b[1] - a[1]);

  // ── HEURISTIC 2: LOW-RATIO AGENTS (Lever 1/7) ────────────────────────────
  const lowRatio = files
    .map(f => {
      const denom = f.output + f.fresh_in + f.cache_write;
      const ratio = denom > 0 ? f.output / denom : 0;
      return { ...f, ratio };
    })
    .filter(f => f.ratio < 0.15)
    .sort((a, b) => a.ratio - b.ratio);

  // ── HEURISTIC 3: TURNY SESSIONS ─────────────────────────────────────────
  const turnySessions = files
    .filter(f => f.calls > 150)
    .map(f => {
      const avgCtx = f.calls > 0 ? Math.round(f.cache_read / f.calls) : 0;
      return { ...f, avgCtx };
    })
    .sort((a, b) => b.calls - a.calls);

  // ── HEURISTIC 4: IDLE BABYSITTING (Lever 3) ──────────────────────────────
  const idleSessions = [];
  for (const f of files) {
    if (f.timestamps.length < 2) continue;
    const sorted = f.timestamps.map(t => t.ts).filter(t => !isNaN(t)).sort((a, b) => a - b);
    let idleMin = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gapMin = (sorted[i] - sorted[i - 1]) / 60_000;
      if (gapMin > 5) idleMin += gapMin;
    }
    if (idleMin > 15) {
      idleSessions.push({ ...f, idleMin: Math.round(idleMin) });
    }
  }
  idleSessions.sort((a, b) => b.idleMin - a.idleMin);

  // ── HEURISTIC 5: MODEL MIX (Lever 7) ─────────────────────────────────────
  const modelOut = {};
  let totalOut = 0;
  let hasSubagents = false;
  for (const r of records) {
    const fam = r.modelFamily;
    modelOut[fam] = (modelOut[fam] || 0) + r.output;
    totalOut += r.output;
    if (r.sessionKind === 'subagent') hasSubagents = true;
  }
  const topTierOut = (modelOut['opus'] || 0);
  const topTierPct = totalOut > 0 ? (topTierOut / totalOut * 100) : 0;

  // ── HEURISTIC 6: SESSION DENSITY (Lever 2) ────────────────────────────────
  const dayBuckets = {};
  for (const r of records) {
    if (!r.timestamp) continue;
    const day = r.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!dayBuckets[day]) dayBuckets[day] = new Set();
    dayBuckets[day].add(r.file);
  }
  const dayEntries = Object.entries(dayBuckets).sort((a, b) => a[0].localeCompare(b[0]));

  // ── HEURISTIC 7: TOOL OUTPUT BLOAT (Lever 8) ─────────────────────────────
  // amplified cost = result_tokens × max(0, file.totalCalls - calls_before)
  // i.e. how many subsequent API calls re-sent this result blob in the cache window.

  const lever8Agg  = {};   // source_key → { amplified, raw_tokens, count, max_raw }
  let   totalAmpli = 0;

  for (const [, meta] of fileMeta) {
    if (!meta || !meta.toolResults) continue;
    for (const tr of meta.toolResults) {
      const call      = meta.toolCallsById.get(tr.tool_use_id);
      const sourceKey = deriveSourceKey(call || null);
      const amplified = tr.result_tokens * Math.max(0, meta.totalCalls - tr.calls_before);

      if (!lever8Agg[sourceKey]) {
        lever8Agg[sourceKey] = { amplified: 0, raw_tokens: 0, count: 0, max_raw: 0 };
      }
      const bucket = lever8Agg[sourceKey];
      bucket.amplified  += amplified;
      bucket.raw_tokens += tr.result_tokens;
      bucket.count      += 1;
      bucket.max_raw     = Math.max(bucket.max_raw, tr.result_tokens);
      totalAmpli        += amplified;
    }
  }

  // Total cache_read across window (for the % summary line)
  const totalCacheRead = records.reduce((s, r) => s + r.cacheRead, 0);

  // Sort by amplified descending, take top 12
  const lever8Rows = Object.entries(lever8Agg)
    .sort((a, b) => b[1].amplified - a[1].amplified)
    .slice(0, 12);

  // ── JSON output (early exit — no table printing) ──────────────────────────
  if (opts.json) {
    const jsonOut = {
      hot_files:        hotFiles.slice(0, 20).map(([fp, cnt]) => ({ file: fp, reads: cnt })),
      low_ratio_agents: lowRatio.slice(0, 10).map(f => ({
        file:  f.file,
        ratio: +f.ratio.toFixed(3),
        calls: f.calls,
      })),
      turny_sessions:   turnySessions.slice(0, 10).map(s => ({
        file:           s.file,
        calls:          s.calls,
        avg_ctx_call:   s.avgCtx,
        total_cache_rd: s.cache_read,
      })),
      idle_sessions:    idleSessions.slice(0, 10).map(s => ({
        file:     s.file,
        calls:    s.calls,
        idle_min: s.idleMin,
      })),
      model_mix:        Object.entries(modelOut).map(([fam, out]) => ({
        family: fam,
        output: out,
        pct:    totalOut > 0 ? +(out / totalOut * 100).toFixed(1) : 0,
      })),
      session_density:  dayEntries.map(([day, sess]) => ({ day, sessions: sess.size })),
      lever8_tool_output: {
        total_amplified_tokens:      Math.round(totalAmpli),
        total_cache_read_tokens:     totalCacheRead,
        resend_multiplier:           resendProjection(totalAmpli, totalCacheRead).multiplier,
        top_sources: lever8Rows.map(([key, b]) => ({
          source_key:       key,
          occurrences:      b.count,
          raw_tokens:       b.raw_tokens,
          amplified_tokens: Math.round(b.amplified),
          avg_raw:          b.count > 0 ? Math.round(b.raw_tokens / b.count) : 0,
          max_raw:          b.max_raw,
        })),
      },
    };
    console.log(JSON.stringify(jsonOut, null, 2));
    return;
  }

  // ── Human-readable tables ─────────────────────────────────────────────────
  console.log('\n=== Token Diagnose ===\n');

  // Lever 5 — Hot files
  console.log('--- [Lever 5] HOT FILES (Read >= 4 times) ---');
  if (hotFiles.length === 0) {
    console.log('  No hot files detected.\n');
  } else {
    const hColW = [60, 6, 14];
    const hHdr  = ['file_path', 'reads', 'est_tokens'];
    console.log('  ' + hHdr.map((h, i) => i === 0 ? padL(h, hColW[i]) : padR(h, hColW[i])).join(' | '));
    console.log('  ' + hline(hColW));
    for (const [fp, cnt] of hotFiles.slice(0, 20)) {
      let estTok = '?';
      try {
        const stat = fs.statSync(fp);
        estTok = fmt(Math.round(stat.size / 4));
      } catch { /* file missing or no access */ }
      const shortPath = fp.length > 58 ? '...' + fp.slice(-55) : fp;
      const cols = [shortPath, String(cnt), estTok];
      console.log('  ' + cols.map((c, i) => i === 0 ? padL(c, hColW[i]) : padR(c, hColW[i])).join(' | '));
    }
    if (hotFiles.length > 20) console.log(`  ... and ${hotFiles.length - 20} more`);
    console.log('');
  }

  // Lever 1/7 — Low-ratio agents
  console.log('--- [Lever 1/7] LOW-RATIO AGENTS (ratio < 0.15) ---');
  if (lowRatio.length === 0) {
    console.log('  No low-ratio agents detected.\n');
  } else {
    for (const f of lowRatio.slice(0, 10)) {
      const name = path.basename(f.file, '.jsonl').slice(0, 30);
      console.log(`  ${padL(name, 32)}  ratio=${f.ratio.toFixed(3)}  calls=${f.calls}`);
      // Show top hot files for this agent
      const topHot = Object.entries(f.readFiles)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      for (const [fp, cnt] of topHot) {
        const short = fp.length > 50 ? '...' + fp.slice(-47) : fp;
        console.log(`    hot-file: ${padL(short, 52)} x${cnt}`);
      }
    }
    console.log('');
  }

  // Turny sessions
  console.log('--- [Cache Mechanics] TURNY SESSIONS (> 150 calls) ---');
  if (turnySessions.length === 0) {
    console.log('  No turny sessions detected.\n');
  } else {
    const tColW = [32, 8, 16, 16];
    const tHdr  = ['session', 'calls', 'avg_ctx/call', 'total_cache_rd'];
    console.log('  ' + tHdr.map((h, i) => i === 0 ? padL(h, tColW[i]) : padR(h, tColW[i])).join(' | '));
    console.log('  ' + hline(tColW));
    for (const s of turnySessions.slice(0, 10)) {
      const name = path.basename(s.file, '.jsonl').slice(0, 30);
      const cols = [name, fmt(s.calls), fmt(s.avgCtx), fmt(s.cache_read)];
      console.log('  ' + cols.map((c, i) => i === 0 ? padL(c, tColW[i]) : padR(c, tColW[i])).join(' | '));
    }
    console.log('');
  }

  // Lever 3 — Idle babysitting
  console.log('--- [Lever 3] IDLE BABYSITTING (> 15 min idle per session) ---');
  if (idleSessions.length === 0) {
    console.log('  No idle-heavy sessions detected.\n');
  } else {
    const iColW = [32, 8, 10];
    const iHdr  = ['session', 'calls', 'idle_min'];
    console.log('  ' + iHdr.map((h, i) => i === 0 ? padL(h, iColW[i]) : padR(h, iColW[i])).join(' | '));
    console.log('  ' + hline(iColW));
    for (const s of idleSessions.slice(0, 10)) {
      const name = path.basename(s.file, '.jsonl').slice(0, 30);
      const cols = [name, fmt(s.calls), fmt(s.idleMin)];
      console.log('  ' + cols.map((c, i) => i === 0 ? padL(c, iColW[i]) : padR(c, iColW[i])).join(' | '));
    }
    console.log('');
  }

  // Lever 7 — Model mix
  console.log('--- [Lever 7] MODEL MIX (output tokens by family) ---');
  for (const [fam, out] of Object.entries(modelOut).sort((a, b) => b[1] - a[1])) {
    const pct = totalOut > 0 ? (out / totalOut * 100).toFixed(1) : '0.0';
    console.log(`  ${padL(fam, 10)}  ${padR(fmt(out), 14)} output tokens  (${padR(pct, 5)}%)`);
  }
  if (topTierPct > 80 && hasSubagents) {
    console.log(`\n  WARNING: top-tier models (opus) account for ${topTierPct.toFixed(1)}% of output`);
    console.log('  while subagent files exist. Consider routing subagents to sonnet/haiku.');
  }
  console.log('');

  // Lever 2 — Session density
  console.log('--- [Lever 2] SESSION DENSITY (sessions per day) ---');
  for (const [day, sess] of dayEntries) {
    console.log(`  ${day}  ${padR(String(sess.size), 4)} sessions`);
  }
  console.log('');

  // Lever 8 — Tool output bloat
  console.log('--- [Lever 8] TOOL OUTPUT BLOAT (cache-read amplified) ---');
  if (lever8Rows.length === 0) {
    console.log('  No tool results found in the scan window.\n');
  } else {
    const l8ColW = [28, 6, 12, 16, 10];
    const l8Hdr  = ['source_key', 'occur', 'raw_tokens', 'amplified_tok', 'avg_raw'];
    console.log('  ' + l8Hdr.map((h, i) => i === 0 ? padL(h, l8ColW[i]) : padR(h, l8ColW[i])).join(' | '));
    console.log('  ' + hline(l8ColW));
    for (const [key, b] of lever8Rows) {
      const avgRaw   = b.count > 0 ? Math.round(b.raw_tokens / b.count) : 0;
      const shortKey = key.length > 26 ? key.slice(0, 23) + '...' : key;
      const cols     = [shortKey, String(b.count), fmt(b.raw_tokens), fmt(b.amplified), fmt(avgRaw)];
      console.log('  ' + cols.map((c, i) => i === 0 ? padL(c, l8ColW[i]) : padR(c, l8ColW[i])).join(' | '));
    }
    console.log('');

    console.log(`  Tool-output ${resendProjection(totalAmpli, totalCacheRead).label}\n`);

    // Recommendations — top Bash programs and repeated-read files
    const bashOffenders = lever8Rows
      .filter(([k]) => !k.startsWith('Read:') && k !== 'unmatched')
      .slice(0, 3);
    const readOffenders = lever8Rows
      .filter(([k]) => k.startsWith('Read:'))
      .slice(0, 3);

    for (const [key] of bashOffenders) {
      console.log(`  Rec: filter ${key} output (failures-only / single-line / dedup) — e.g. via a PostToolUse output-filter hook`);
    }
    for (const [key, b] of readOffenders) {
      const file = key.replace(/^Read:/, '');
      console.log(`  Rec: ${file} is large + re-read (${fmt(b.raw_tokens)} raw tokens, ${b.count}x) — digest it (Lever 5) or read only needed ranges`);
    }
    console.log('');
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('=== ADDRESSABLE SHARE ESTIMATES (rough order of magnitude) ===');
  const levers = [
    { lever: 'Lever 1/7  Low-ratio agents',  pct: lowRatio.length > 0       ? '15-30%' : '~0%',  note: 'route to cheaper model or reduce context' },
    { lever: 'Lever 2    Session density',    pct: dayEntries.length > 0     ? '5-15%'  : 'n/a',  note: '/clear more often, consolidate short sessions' },
    { lever: 'Lever 3    Idle babysitting',   pct: idleSessions.length > 0   ? '10-25%' : '~0%',  note: 'run long tasks unattended, reduce polling' },
    { lever: 'Lever 5    Hot files',          pct: hotFiles.length > 0       ? '20-40%' : '~0%',  note: 'consolidate or cache frequently read files' },
    { lever: 'Lever 7    Model mix',          pct: topTierPct > 80           ? '10-30%' : '<5%',  note: 'sonnet for subagents, opus for synthesis only' },
    { lever: 'Lever 8    Tool output bloat',  pct: totalAmpli > 50_000       ? '10-25%' : '~0%',  note: 'filter bash/read output via a PostToolUse hook' },
    { lever: 'Cache-mech Turny sessions',     pct: turnySessions.length > 0  ? '5-15%'  : '~0%',  note: '/clear every N turns to reset cache window' },
  ];

  for (const l of levers) {
    console.log(`  ${padL(l.lever, 32)}  ${padR(l.pct, 7)}  — ${l.note}`);
  }
  console.log('\n  Estimates are illustrative. Actual savings depend on workflow and data volume.\n');
}

module.exports = { runDiagnose, resendProjection };

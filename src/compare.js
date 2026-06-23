'use strict';
/**
 * compare.js — re-measure bookend: before vs after window comparison
 *
 * Window "before" = (now - A days) .. (now - B days)
 * Window "after"  = last B days
 *
 * Per-day averages of: fresh_in, cache_write, cache_read, output, calls,
 * sessions/day for each window; delta % column; verdict line.
 *
 * Guard: warn if either window has < 50 calls (low confidence).
 *
 * Usage:
 *   token-diet compare --before-days A --after-days B [--project <slug>] [--json]
 */

const { scanAll } = require('./scan');

function fmt(n)     { return Math.round(n).toLocaleString('en-US'); }
function padL(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }
function hline(ws)  { return ws.map(w => '-'.repeat(w)).join('-+-'); }

function pct(before, after) {
  if (before === 0) return after === 0 ? '  0.0%' : '+∞%';
  const d = (after - before) / before * 100;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}
// Numeric counterpart of pct() — used for the verdict so it never round-trips a
// non-numeric label like "+∞%" through parseFloat (which would yield NaN).
function pctNum(before, after) {
  if (before === 0) return after === 0 ? 0 : Infinity;
  return (after - before) / before * 100;
}

function perCallMetrics(total, numCalls) {
  const n = numCalls || 1;
  return { fresh_in: total.fresh_in / n, cache_write: total.cache_write / n,
           cache_read: total.cache_read / n, output: total.output / n };
}
function volumeChangedPct(beforeCalls, afterCalls) {
  if (beforeCalls === 0) return afterCalls === 0 ? 0 : 100;
  return Math.abs(afterCalls - beforeCalls) / beforeCalls * 100;
}

/**
 * Split a single [beforeMs, now) scan into the before/after windows by `splitMs`.
 * Replaces the old double scanWindow() — we now scan ONCE via scanAll (which brings
 * the bounded-parallel reads + window-skip) and bucket here.
 *
 * Parity with the previous two-window scan:
 *   • dated record: before = [beforeMs, splitMs), after = [splitMs, now) (== boundary → after)
 *   • undated / unparseable-timestamp record: the old code, lacking a usable ms, left it
 *     UNFILTERED in BOTH windows — so it lands in both here too (aggregate() then excludes
 *     it from per-day math and reports the count). Real transcripts have none of these.
 */
function bucketByWindow(records, splitMs) {
  const before = [];
  const after  = [];
  for (const r of records) {
    const ms = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (isNaN(ms)) { before.push(r); after.push(r); continue; }
    (ms < splitMs ? before : after).push(r);
  }
  return { before, after };
}

/** Aggregate per-day stats from a record array */
function aggregate(records) {
  const days = {};
  let undated = 0;
  for (const r of records) {
    // Undated records can't belong to a calendar day. Counting them as an 'unknown'
    // day would add a phantom day to the denominator and silently dilute every per-day
    // average (and could fabricate a before/after delta). Exclude them from the per-day
    // math; surface their count separately.
    if (!r.timestamp) { undated++; continue; }
    const day = r.timestamp.slice(0, 10);
    if (!days[day]) {
      days[day] = { fresh_in: 0, cache_write: 0, cache_read: 0, output: 0, calls: 0, sessions: new Set() };
    }
    days[day].fresh_in    += r.input;
    days[day].cache_write += r.cacheWrite;
    days[day].cache_read  += r.cacheRead;
    days[day].output      += r.output;
    days[day].calls       += 1;
    days[day].sessions.add(r.file);
  }

  const numDays = Math.max(Object.keys(days).length, 1);
  const totals  = { fresh_in: 0, cache_write: 0, cache_read: 0, output: 0, calls: 0, sessions: 0 };
  for (const d of Object.values(days)) {
    totals.fresh_in    += d.fresh_in;
    totals.cache_write += d.cache_write;
    totals.cache_read  += d.cache_read;
    totals.output      += d.output;
    totals.calls       += d.calls;
    totals.sessions    += d.sessions.size;
  }

  return {
    perDay: {
      fresh_in:    totals.fresh_in    / numDays,
      cache_write: totals.cache_write / numDays,
      cache_read:  totals.cache_read  / numDays,
      output:      totals.output      / numDays,
      calls:       totals.calls       / numDays,
      sessions:    totals.sessions    / numDays,
    },
    total:   totals,
    numDays,
    numCalls: totals.calls,   // dated calls — consistent with per-day + per-call math
    undated,
  };
}

async function runCompare(opts = {}) {
  const beforeDays = opts.beforeDays != null ? +opts.beforeDays : null;
  const afterDays  = opts.afterDays  != null ? +opts.afterDays  : null;

  if (beforeDays == null || afterDays == null) {
    console.error('compare requires --before-days A and --after-days B');
    process.exit(1);
  }
  if (afterDays >= beforeDays) {
    console.error(`--after-days (${afterDays}) must be less than --before-days (${beforeDays})`);
    process.exit(1);
  }

  const now      = Date.now();
  const splitMs  = now - afterDays  * 86400_000;

  // Scan ONCE over the whole [beforeMs, now) range (days = beforeDays), then split.
  const { records } = await scanAll({ days: beforeDays, project: opts.project || null });
  const { before: beforeRecords, after: afterRecords } = bucketByWindow(records, splitMs);

  const before = aggregate(beforeRecords);
  const after  = aggregate(afterRecords);

  const lowConfidence = [];
  if (before.numCalls < 50) lowConfidence.push(`before window only has ${before.numCalls} calls`);
  if (after.numCalls  < 50) lowConfidence.push(`after window only has ${after.numCalls} calls`);

  if (opts.json) {
    console.log(JSON.stringify({
      windows: {
        before: { fromDays: beforeDays, toDays: afterDays, numCalls: before.numCalls, numDays: before.numDays, undated: before.undated },
        after:  { fromDays: afterDays,  toDays: 0,         numCalls: after.numCalls,  numDays: after.numDays, undated: after.undated },
      },
      perDay: {
        before: before.perDay,
        after:  after.perDay,
      },
      lowConfidence,
    }, null, 2));
    return;
  }

  // ── Human-readable output ─────────────────────────────────────────────────
  console.log('\n=== Token Compare: Before vs After ===\n');

  const bLabel = `before (${beforeDays}d→${afterDays}d ago, ${before.numDays} active days)`;
  const aLabel = `after  (last ${afterDays}d, ${after.numDays} active days)`;

  console.log(`  Before window: ${before.numCalls} calls over ${before.numDays} active day(s)`);
  console.log(`  After  window: ${after.numCalls} calls over ${after.numDays} active day(s)`);
  if (before.undated || after.undated)
    console.log(`  (${before.undated + after.undated} undated record(s) excluded from per-day math)`);
  console.log('');

  if (lowConfidence.length > 0) {
    for (const w of lowConfidence) {
      console.log(`  WARNING: ${w} — results are low-confidence`);
    }
    console.log('');
  }

  const metrics = ['fresh_in', 'cache_write', 'cache_read', 'output', 'calls', 'sessions'];
  const colW    = [14, 16, 16, 10];
  const headers = ['metric', 'before/day', 'after/day', 'delta'];
  console.log(headers.map((h, i) => i === 0 ? padL(h, colW[i]) : padR(h, colW[i])).join(' | '));
  console.log(hline(colW));

  const deltaData = {};
  for (const m of metrics) {
    const b = before.perDay[m] || 0;
    const a = after.perDay[m]  || 0;
    const d = pct(b, a);
    deltaData[m] = { before: b, after: a, delta: d, deltaNum: pctNum(b, a) };
    const cols = [m, fmt(Math.round(b)), fmt(Math.round(a)), d];
    console.log(cols.map((c, i) => i === 0 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));
  }
  console.log(hline(colW));

  // ── per-call normalization (F6) ───────────────────────────────────────────
  const bpc = perCallMetrics(before.total, before.numCalls);
  const apc = perCallMetrics(after.total,  after.numCalls);
  console.log('\n  Per-call (normalizes for volume):');
  for (const m of ['cache_read', 'output']) {
    console.log(`    ${padL(m, 12)} ${padR(fmt(Math.round(bpc[m])), 10)} -> ${padR(fmt(Math.round(apc[m])), 10)}  (${pct(bpc[m], apc[m])})`);
  }
  const vol = volumeChangedPct(before.numCalls, after.numCalls);
  if (vol > 25) {
    console.log(`\n  CAVEAT: call volume changed ${vol.toFixed(0)}% — per-day deltas are partly volume, not efficiency. Trust the per-call line.`);
  }

  // Verdict line
  const outDelta = deltaData['output'];
  const callDelta = deltaData['calls'];
  const crDelta   = deltaData['cache_read'];

  const verdictPart = (label, dd) => {
    if (!dd) return null;
    const d = dd.deltaNum;
    if (!isFinite(d)) return `${label} up (from zero)`;
    return `${label} ${d < 0 ? 'down' : 'up'} ${Math.abs(d).toFixed(1)}%`;
  };
  const verdictParts = [
    verdictPart('output/day',     outDelta),
    verdictPart('calls/day',      callDelta),
    verdictPart('cache_read/day', crDelta),
  ].filter(Boolean);

  console.log('\n  Verdict: ' + (verdictParts.length > 0 ? verdictParts.join(', ') : 'no data'));
  if (lowConfidence.length > 0) {
    console.log('  (low confidence — gather more data before drawing conclusions)');
  }
  console.log('');
}

module.exports = { runCompare, perCallMetrics, volumeChangedPct, pct, pctNum, aggregate, bucketByWindow };

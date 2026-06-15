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

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { scanAll, resolveProjectDirs, collectJsonlFiles } = require('./scan');

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

function perCallMetrics(total, numCalls) {
  const n = numCalls || 1;
  return { fresh_in: total.fresh_in / n, cache_write: total.cache_write / n,
           cache_read: total.cache_read / n, output: total.output / n };
}
function volumeChangedPct(beforeCalls, afterCalls) {
  if (beforeCalls === 0) return afterCalls === 0 ? 0 : 100;
  return Math.abs(afterCalls - beforeCalls) / beforeCalls * 100;
}

/** Scan records for a specific time window [fromMs, toMs) */
async function scanWindow(fromMs, toMs, projectFilter) {
  const dirs  = resolveProjectDirs(projectFilter);
  const files = collectJsonlFiles(dirs);

  // We implement a custom window scan since scanAll only supports "last N days"
  const records = [];

  const readline = require('readline');

  for (const filePath of files) {
    await new Promise((resolve) => {
      let stream;
      try { stream = fs.createReadStream(filePath, { encoding: 'utf8' }); }
      catch { return resolve(); }

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      const pending = new Map();

      rl.on('line', (line) => {
        if (!line.trim()) return;
        let obj;
        try { obj = JSON.parse(line); } catch { return; }
        if (obj.type !== 'assistant') return;
        const usage = obj.message && obj.message.usage;
        if (!usage) return;

        const callId  = obj.requestId || (obj.message && obj.message.id) || null;
        const tsRaw   = obj.timestamp || (obj.message && obj.message.timestamp) || null;

        if (!pending.has(callId)) {
          // Time window filter
          if (tsRaw) {
            const ms = Date.parse(tsRaw);
            if (!isNaN(ms) && (ms < fromMs || ms >= toMs)) {
              pending.set(callId, null);
              return;
            }
          }

          const modelStr = (obj.message && obj.message.model) || '';
          const record = {
            file:        filePath,
            sessionKind: path.basename(filePath).startsWith('agent-') ? 'subagent' : 'session',
            timestamp:   tsRaw,
            input:       +(usage.input_tokens || 0),
            cacheWrite:  +(usage.cache_creation_input_tokens || 0),
            cacheRead:   +(usage.cache_read_input_tokens || 0),
            output:      +(usage.output_tokens || 0),
          };
          pending.set(callId, record);
        }

        const record = pending.get(callId);
        if (!record) return;

        if (callId === null) {
          pending.delete(callId);
          records.push(record);
        }
      });

      rl.on('close', () => {
        for (const [, record] of pending) {
          if (record) records.push(record);
        }
        resolve();
      });
      rl.on('error', () => resolve());
    });
  }

  return records;
}

/** Aggregate per-day stats from a record array */
function aggregate(records) {
  const days = {};
  for (const r of records) {
    const day = r.timestamp ? r.timestamp.slice(0, 10) : 'unknown';
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

  const numDays = Math.max(Object.keys(days).filter(d => d !== 'unknown').length, 1);
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
    numCalls: records.length,
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
  const beforeMs = now - beforeDays * 86400_000;
  const splitMs  = now - afterDays  * 86400_000;

  const [beforeRecords, afterRecords] = await Promise.all([
    scanWindow(beforeMs, splitMs, opts.project || null),
    scanWindow(splitMs,  now,     opts.project || null),
  ]);

  const before = aggregate(beforeRecords);
  const after  = aggregate(afterRecords);

  const lowConfidence = [];
  if (before.numCalls < 50) lowConfidence.push(`before window only has ${before.numCalls} calls`);
  if (after.numCalls  < 50) lowConfidence.push(`after window only has ${after.numCalls} calls`);

  if (opts.json) {
    console.log(JSON.stringify({
      windows: {
        before: { fromDays: beforeDays, toDays: afterDays, numCalls: before.numCalls, numDays: before.numDays },
        after:  { fromDays: afterDays,  toDays: 0,         numCalls: after.numCalls,  numDays: after.numDays },
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
  console.log(`  After  window: ${after.numCalls} calls over ${after.numDays} active day(s)\n`);

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
    deltaData[m] = { before: b, after: a, delta: d };
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

  const verdictParts = [];
  if (outDelta) {
    const sign = parseFloat(outDelta.delta) < 0 ? 'down' : 'up';
    verdictParts.push(`output/day ${sign} ${Math.abs(parseFloat(outDelta.delta)).toFixed(1)}%`);
  }
  if (callDelta) {
    const sign = parseFloat(callDelta.delta) < 0 ? 'down' : 'up';
    verdictParts.push(`calls/day ${sign} ${Math.abs(parseFloat(callDelta.delta)).toFixed(1)}%`);
  }
  if (crDelta) {
    const sign = parseFloat(crDelta.delta) < 0 ? 'down' : 'up';
    verdictParts.push(`cache_read/day ${sign} ${Math.abs(parseFloat(crDelta.delta)).toFixed(1)}%`);
  }

  console.log('\n  Verdict: ' + (verdictParts.length > 0 ? verdictParts.join(', ') : 'no data'));
  if (lowConfidence.length > 0) {
    console.log('  (low confidence — gather more data before drawing conclusions)');
  }
  console.log('');
}

module.exports = { runCompare, perCallMetrics, volumeChangedPct };

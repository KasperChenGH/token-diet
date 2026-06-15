'use strict';
/**
 * agents.js — per-file agent efficiency report
 *
 * Useful-work ratio = output / (output + fresh_in + cache_write)
 *   - Numerator:   output tokens (what the model actually generated)
 *   - Denominator: output + fresh_in + cache_write  (everything "paid for")
 *   - cache_read is free (already cached), so excluded from denominator
 *   - A ratio < 0.15 means the agent spent > 85% of paid tokens on context
 *     rather than producing output → "READING NOT THINKING"
 *
 * Sorted ascending (worst ratio first).
 */

const path     = require('path');
const { scanAll } = require('./scan');

function fmt(n)      { return Math.round(n).toLocaleString('en-US'); }
function padL(s, w)  { return String(s).padEnd(w); }
function padR(s, w)  { return String(s).padStart(w); }
function hline(ws)   { return ws.map(w => '-'.repeat(w)).join('-+-'); }

async function runAgents(opts = {}) {
  const { records } = await scanAll(opts);

  if (records.length === 0) {
    console.log('No records found for the given filters.');
    return;
  }

  // Aggregate per file
  const files = {};
  for (const r of records) {
    const key = r.file;
    if (!files[key]) {
      files[key] = {
        file:        r.file,
        sessionKind: r.sessionKind,
        calls:       0,
        fresh_in:    0,
        cache_write: 0,
        cache_read:  0,
        output:      0,
      };
    }
    const f = files[key];
    f.calls       += 1;
    f.fresh_in    += r.input;
    f.cache_write += r.cacheWrite;
    f.cache_read  += r.cacheRead;
    f.output      += r.output;
  }

  const rows = Object.values(files).map(f => {
    const denom = f.output + f.fresh_in + f.cache_write;
    const ratio = denom > 0 ? f.output / denom : 0;
    const avgCtx = f.calls > 0 ? Math.round(f.cache_read / f.calls) : 0;
    return { ...f, ratio, avgCtx };
  });

  // Sort ascending by ratio (worst first)
  rows.sort((a, b) => a.ratio - b.ratio);

  if (opts.json) {
    console.log(JSON.stringify(rows.map(r => ({
      file:        r.file,
      sessionKind: r.sessionKind,
      calls:       r.calls,
      ratio:       +r.ratio.toFixed(4),
      avgCtxPerCall: r.avgCtx,
      output:      r.output,
      flag:        r.ratio < 0.15 ? 'READING NOT THINKING' : '',
    })), null, 2));
    return;
  }

  console.log('\n=== Agent Efficiency (sorted by ratio asc — worst first) ===');
  console.log('Formula: ratio = output / (output + fresh_in + cache_write)\n');

  const colW    = [22, 8, 7, 8, 16, 12, 22];
  const headers = ['file (18-char)', 'kind', 'calls', 'ratio', 'avg_ctx/call', 'output', 'flag'];
  console.log(headers.map((h, i) => i < 2 ? padL(h, colW[i]) : padR(h, colW[i])).join(' | '));
  console.log(hline(colW));

  for (const r of rows) {
    const name = path.basename(r.file, '.jsonl').slice(0, 20);
    const flag = r.ratio < 0.15 ? 'READING NOT THINKING' : '';
    const cols = [
      name,
      r.sessionKind.slice(0, 7),
      fmt(r.calls),
      r.ratio.toFixed(3),
      fmt(r.avgCtx),
      fmt(r.output),
      flag,
    ];
    console.log(cols.map((c, i) => i < 2 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));
  }

  const flagCount = rows.filter(r => r.ratio < 0.15).length;
  console.log(`\n${flagCount} of ${rows.length} files flagged as READING NOT THINKING (ratio < 0.15)\n`);
}

module.exports = { runAgents };

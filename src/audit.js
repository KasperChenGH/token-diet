'use strict';
/**
 * audit.js — token usage breakdown by session-kind × model-family
 *
 * Columns: fresh_in, cache_write, cache_read, output, calls
 * Also: per-session top-10 by (output + cache_write), showing session prefix,
 *       call count, duration (first→last timestamp, minutes), output, cache_write
 */

const path     = require('path');
const { scanAll } = require('./scan');

// ── formatting helpers ────────────────────────────────────────────────────────

function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function padL(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }

function hline(widths) {
  return widths.map(w => '-'.repeat(w)).join('-+-');
}

// ── main ─────────────────────────────────────────────────────────────────────

async function runAudit(opts = {}) {
  const { records } = await scanAll(opts);

  if (records.length === 0) {
    console.log('No records found for the given filters.');
    console.log('  Try `token-diet review --dir .` for a zero-history grade, or widen with --days N / check --project.');
    return;
  }

  // ── 1. Group by (sessionKind, modelFamily) ───────────────────────────────
  const groups = {};
  for (const r of records) {
    const key = `${r.sessionKind}|${r.modelFamily}`;
    if (!groups[key]) {
      groups[key] = {
        sessionKind: r.sessionKind,
        modelFamily: r.modelFamily,
        fresh_in: 0, cache_write: 0, cache_read: 0, output: 0, calls: 0,
      };
    }
    const g = groups[key];
    g.fresh_in    += r.input;
    g.cache_write += r.cacheWrite;
    g.cache_read  += r.cacheRead;
    g.output      += r.output;
    g.calls       += 1;
  }

  const rows = Object.values(groups).sort((a, b) => {
    if (a.sessionKind !== b.sessionKind) return a.sessionKind.localeCompare(b.sessionKind);
    return a.modelFamily.localeCompare(b.modelFamily);
  });

  // Totals
  const totals = { fresh_in: 0, cache_write: 0, cache_read: 0, output: 0, calls: 0 };
  for (const g of rows) {
    totals.fresh_in    += g.fresh_in;
    totals.cache_write += g.cache_write;
    totals.cache_read  += g.cache_read;
    totals.output      += g.output;
    totals.calls       += g.calls;
  }

  if (opts.json) {
    console.log(JSON.stringify({ groups: rows, totals }, null, 2));
    return;
  }

  // ── Print table ──────────────────────────────────────────────────────────
  const colW    = [10, 10, 16, 16, 16, 12, 8];
  const headers = ['kind', 'model', 'fresh_in', 'cache_write', 'cache_read', 'output', 'calls'];

  console.log('\n=== Token Audit ===\n');
  console.log(headers.map((h, i) => i < 2 ? padL(h, colW[i]) : padR(h, colW[i])).join(' | '));
  console.log(hline(colW));

  for (const g of rows) {
    const cols = [
      g.sessionKind, g.modelFamily,
      fmt(g.fresh_in), fmt(g.cache_write), fmt(g.cache_read), fmt(g.output), fmt(g.calls),
    ];
    console.log(cols.map((c, i) => i < 2 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));
  }

  console.log(hline(colW));
  const tcols = [
    'TOTAL', '',
    fmt(totals.fresh_in), fmt(totals.cache_write), fmt(totals.cache_read),
    fmt(totals.output),   fmt(totals.calls),
  ];
  console.log(tcols.map((c, i) => i < 2 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));

  // ── 2. Per-session top-10 by (output + cache_write) ──────────────────────
  const sessions = {};
  for (const r of records) {
    const key = r.file;
    if (!sessions[key]) {
      sessions[key] = {
        file:        r.file,
        sessionId:   r.sessionId,
        sessionKind: r.sessionKind,
        calls:       0,
        output:      0,
        cache_write: 0,
        timestamps:  [],
      };
    }
    const s = sessions[key];
    s.calls       += 1;
    s.output      += r.output;
    s.cache_write += r.cacheWrite;
    if (r.timestamp) s.timestamps.push(Date.parse(r.timestamp));
  }

  const sessionList = Object.values(sessions);
  sessionList.sort((a, b) => (b.output + b.cache_write) - (a.output + a.cache_write));
  const top10 = sessionList.slice(0, 10);

  console.log('\n--- Top 10 sessions by (output + cache_write) ---\n');

  const sColW = [20, 8, 8, 12, 12, 12];
  const sHdr  = ['session-id', 'kind', 'calls', 'duration(m)', 'output', 'cache_write'];
  console.log(sHdr.map((h, i) => i < 2 ? padL(h, sColW[i]) : padR(h, sColW[i])).join(' | '));
  console.log(hline(sColW));

  for (const s of top10) {
    const id18 = path.basename(s.file, '.jsonl').slice(0, 18);
    let duration = '?';
    if (s.timestamps.length >= 2) {
      const mn = Math.min(...s.timestamps);
      const mx = Math.max(...s.timestamps);
      duration = String(Math.round((mx - mn) / 60_000));
    } else if (s.timestamps.length === 1) {
      duration = '0';
    }
    const cols = [
      id18,
      s.sessionKind.slice(0, 7),
      fmt(s.calls),
      duration,
      fmt(s.output),
      fmt(s.cache_write),
    ];
    console.log(cols.map((c, i) => i < 2 ? padL(c, sColW[i]) : padR(c, sColW[i])).join(' | '));
  }

  console.log('');
}

module.exports = { runAudit };

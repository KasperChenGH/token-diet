'use strict';
/**
 * burn.js — billing-window / burn-rate view (Tier 3 reporting).
 *
 * Claude usage limits reset on a rolling 5-hour block. This buckets recent transcript
 * records into epoch-aligned 5-hour blocks and shows raw + price-weighted tokens per block,
 * then projects the CURRENT block to its end at the rate so far. Builds trust by making the
 * limit-relevant unit (the 5h block) visible, not just per-day averages.
 *
 * Reconciliation with ccusage: ccusage anchors each block to the FIRST activity in a rolling
 * window; we use simple epoch-aligned blocks (floor(ms / 5h) * 5h) so the math is deterministic
 * and explainable. Totals match; block *boundaries* can differ by up to one block — documented
 * so our numbers are reconcilable with the de-facto CC cost CLI rather than silently divergent.
 */
const { scanAll } = require('./scan');
const { PRICE }   = require('./estimate');

const BLOCK_HOURS = 5;
const BLOCK_MS    = BLOCK_HOURS * 3600 * 1000;

// Map a record's token counts onto estimate.js's weighted model (fresh input + cache write are
// "write"-priced, cache read is cheap, output at output price) so the weighting is consistent
// with `estimate`/`savings`.
function weightedOf(r) {
  return (r.input + r.cacheWrite) * PRICE.write + r.cacheRead * PRICE.read + r.output * PRICE.output;
}
function rawOf(r) { return r.input + r.cacheWrite + r.cacheRead + r.output; }

/**
 * Bucket records into epoch-aligned 5-hour blocks. Pure; undated records are dropped (a block is
 * a time window) and counted separately.
 * @param {{timestamp:?string, input:number, cacheWrite:number, cacheRead:number, output:number, file:string}[]} records
 * @param {number} nowMs                     used to flag the current block (isCurrent)
 * @returns {{rows: {start:number,end:number,raw:number,weighted:number,calls:number,sessions:number,isCurrent:boolean}[], undated:number}}
 */
function bucketBlocks(records, nowMs) {
  const blocks = new Map();
  let undated = 0;
  for (const r of records) {
    const ms = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (isNaN(ms)) { undated++; continue; }
    const start = Math.floor(ms / BLOCK_MS) * BLOCK_MS;
    let b = blocks.get(start);
    if (!b) { b = { start, raw: 0, weighted: 0, calls: 0, sessions: new Set() }; blocks.set(start, b); }
    b.raw += rawOf(r); b.weighted += weightedOf(r); b.calls += 1; b.sessions.add(r.file);
  }
  const rows = [...blocks.values()].map(b => ({
    start: b.start, end: b.start + BLOCK_MS, raw: b.raw, weighted: b.weighted,
    calls: b.calls, sessions: b.sessions.size,
    isCurrent: nowMs >= b.start && nowMs < b.start + BLOCK_MS,
  })).sort((a, b) => a.start - b.start);
  return { rows, undated };
}

// Project the current block to its end at the rate observed so far this block.
function projectCurrent(row, nowMs) {
  if (!row) return null;
  // Clamp elapsed into (0, BLOCK_MS]: a future/clock-skewed `now` before the block start must not
  // floor to 1ms and blow the projection up by ~5h worth of extrapolation.
  const elapsed = Math.min(BLOCK_MS, Math.max(1, nowMs - row.start));
  const frac = elapsed / BLOCK_MS;
  return {
    pctElapsed: Math.round(frac * 100),
    projectedRaw: Math.round(row.raw / frac),
    projectedWeighted: Math.round(row.weighted / frac),
    remainingMin: Math.max(0, Math.round((row.start + BLOCK_MS - nowMs) / 60000)),
  };
}

const fmt = n => Math.round(n).toLocaleString('en-US');
const hhmm = ms => { const d = new Date(ms); const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

async function runBurn(opts = {}) {
  const days = opts.days != null ? +opts.days : 2;
  const nowMs = opts._nowMs || Date.now();
  const { records } = await scanAll({ days, project: opts.project || null });
  const { rows, undated } = bucketBlocks(records, nowMs);

  if (opts.json) {
    const current = rows.find(r => r.isCurrent) || null;
    console.log(JSON.stringify({ blockHours: BLOCK_HOURS, blocks: rows, undated,
      currentProjection: projectCurrent(current, nowMs) }, null, 2));
    return;
  }

  console.log(`\n=== token-diet burn — ${BLOCK_HOURS}-hour billing blocks (last ${days}d) ===`);
  console.log('  Raw = sum of all token kinds; weighted = price-model ($) consistent with `estimate`.');
  console.log('  Blocks are epoch-aligned 5h windows (see `burn` notes re: ccusage).\n');
  if (!rows.length) {
    console.log('  No dated activity in the window. Use Claude Code, then re-run.\n');
    return;
  }
  console.log('  block start (local)  |  calls | sess |        raw |   weighted');
  console.log('  ---------------------+--------+------+------------+-----------');
  for (const r of rows) {
    const mark = r.isCurrent ? '▶' : ' ';
    console.log(`  ${mark}${hhmm(r.start).padEnd(19)}| ${String(r.calls).padStart(6)} | ${String(r.sessions).padStart(4)} | ${fmt(r.raw).padStart(10)} | ${fmt(r.weighted).padStart(9)}`);
  }
  const current = rows.find(r => r.isCurrent);
  if (current) {
    const p = projectCurrent(current, nowMs);
    console.log(`\n  Current block: ${p.pctElapsed}% elapsed, ${p.remainingMin} min to reset.`);
    console.log(`  At this rate → ~${fmt(p.projectedRaw)} raw · ~${fmt(p.projectedWeighted)} weighted by block end.`);
  } else {
    console.log('\n  No activity in the current 5h block.');
  }
  console.log('  Reconcile with ccusage: totals match; block boundaries may differ by up to one block.\n');
}

module.exports = { BLOCK_HOURS, BLOCK_MS, weightedOf, rawOf, bucketBlocks, projectCurrent, runBurn };

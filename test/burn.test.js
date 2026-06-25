'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const B = require('../src/burn');

// A record at a given ISO time with token counts.
const rec = (ts, o = {}) => ({
  timestamp: ts, file: o.file || 's1',
  input: o.input || 0, cacheWrite: o.cacheWrite || 0, cacheRead: o.cacheRead || 0, output: o.output || 0,
});

test('bucketBlocks groups records into epoch-aligned 5-hour blocks', () => {
  // Derive boundaries from the formula (epoch-aligned 5h blocks drift across clock days).
  const BLOCK = B.BLOCK_MS;
  const aStart = Math.floor(Date.parse('2026-06-25T12:00:00.000Z') / BLOCK) * BLOCK;
  const tA1 = new Date(aStart + 1000).toISOString();          // block A
  const tA2 = new Date(aStart + BLOCK - 1000).toISOString();   // still block A
  const tB  = new Date(aStart + BLOCK + 1000).toISOString();   // block B
  const now = aStart + BLOCK + 2000;                           // inside block B
  const { rows } = B.bucketBlocks([rec(tA1, { output: 10 }), rec(tA2, { output: 20 }), rec(tB, { output: 5 })], now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].calls, 2);     // block A has two records
  assert.equal(rows[1].calls, 1);     // block B has one
  assert.equal(rows[0].raw, 30);      // 10 + 20
  assert.ok(rows[1].isCurrent);       // now is inside block B
  assert.equal(rows[0].isCurrent, false);
});

test('weighting matches the estimate price model (write/read/output)', () => {
  const { PRICE } = require('../src/estimate');
  const r = rec('2026-06-25T00:00:00.000Z', { input: 100, cacheWrite: 200, cacheRead: 1000, output: 50 });
  const expected = (100 + 200) * PRICE.write + 1000 * PRICE.read + 50 * PRICE.output;
  assert.equal(B.weightedOf(r), expected);
  assert.equal(B.rawOf(r), 1350);
});

test('undated records are dropped from blocks and counted', () => {
  const now = Date.parse('2026-06-25T06:30:00.000Z');
  const { rows, undated } = B.bucketBlocks([rec(null, { output: 9 }), rec('2026-06-25T06:00:00.000Z', { output: 1 })], now);
  assert.equal(undated, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw, 1);
});

test('projectCurrent extrapolates the current block to its end at the rate so far', () => {
  // Block start 05:00Z, now 06:00Z → 1h of a 5h block elapsed (20%).
  const start = Math.floor(Date.parse('2026-06-25T06:00:00.000Z') / B.BLOCK_MS) * B.BLOCK_MS;
  const now = start + 3600 * 1000;   // 1 hour into the block
  const row = { start, end: start + B.BLOCK_MS, raw: 1000, weighted: 500, isCurrent: true };
  const p = B.projectCurrent(row, now);
  assert.equal(p.pctElapsed, 20);
  assert.equal(p.projectedRaw, 5000);       // 1000 / 0.2
  assert.equal(p.projectedWeighted, 2500);  // 500 / 0.2
  assert.equal(p.remainingMin, 240);        // 4h left
});

test('projectCurrent is null when there is no current block', () => {
  assert.equal(B.projectCurrent(null, 123), null);
});

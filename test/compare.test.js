'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const C = require('../src/compare');

test('perCallMetrics: divides totals by calls', () => {
  const m = C.perCallMetrics({ fresh_in: 1000, cache_write: 2000, cache_read: 8000, output: 500 }, 100);
  assert.equal(m.cache_read, 80);
  assert.equal(m.output, 5);
});

test('volumeChangedPct: flags a >25% shift', () => {
  assert.ok(C.volumeChangedPct(100, 200) > 25);   // +100%
  assert.ok(C.volumeChangedPct(100, 110) <= 25);  // +10%
  assert.equal(C.volumeChangedPct(0, 0), 0);
});

test('pctNum: zero-baseline → Infinity (not NaN); both-zero → 0; normal delta', () => {
  assert.equal(C.pctNum(0, 0), 0);
  assert.equal(C.pctNum(0, 500), Infinity);
  assert.equal(C.pctNum(100, 80), -20);
  assert.equal(C.pctNum(100, 150), 50);
  assert.ok(!Number.isFinite(C.pctNum(0, 5)));    // verdict guards on isFinite → never prints NaN
});

test('aggregate: undated records do not inflate per-day averages (regression)', () => {
  const records = [
    { timestamp: '2026-06-10T12:00:00.000Z', input: 0, cacheWrite: 0, cacheRead: 0, output: 100, file: 'f1' },
    { timestamp: undefined,                   input: 0, cacheWrite: 0, cacheRead: 0, output: 100, file: 'f2' },
  ];
  const a = C.aggregate(records);
  assert.equal(a.numDays, 1);                      // only the real calendar day counts
  assert.equal(a.undated, 1);                      // the undated record is excluded + surfaced
  assert.equal(a.numCalls, 1);                     // dated calls only
  assert.equal(Math.round(a.perDay.output), 100);  // 100/1 — no phantom day diluting the average
});

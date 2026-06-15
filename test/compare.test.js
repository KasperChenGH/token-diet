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

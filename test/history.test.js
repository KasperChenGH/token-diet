'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { tmpDir, rm } = require('./helpers');
const H = require('../src/history');

test('appendRun + readHistory round-trip', () => {
  const dir = tmpDir();
  H.appendRun(dir, { ts: '2026-01-01', items: [1, 2] });
  H.appendRun(dir, { ts: '2026-01-02', items: [3] });
  const h = H.readHistory(dir);
  assert.equal(h.runs.length, 2);
  assert.deepEqual(h.runs[1].items, [3]);
  rm(dir);
});

test('rejectedItemKeys collects across runs; regrowth detects a re-grown file', () => {
  const dir = tmpDir();
  H.appendRun(dir, { ts: 't1', rejected: ['L6:CLAUDE.md'], trimmed: { 'CLAUDE.md': 90 } });
  const rejected = H.rejectedItemKeys(H.readHistory(dir));
  assert.ok(rejected.has('L6:CLAUDE.md'));
  assert.equal(H.regrowth(H.readHistory(dir), 'CLAUDE.md', 200), true);
  assert.equal(H.regrowth(H.readHistory(dir), 'CLAUDE.md', 95),  false);
  rm(dir);
});

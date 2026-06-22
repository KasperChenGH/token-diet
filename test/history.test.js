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

test('baseline get/set round-trips and coexists with runs', () => {
  const dir = tmpDir();
  assert.equal(H.getBaseline(dir), null);                         // none yet
  H.appendRun(dir, { ts: 't1', items: [1] });
  H.setBaseline(dir, { grade: 'B', findings: 3, ts: 't1' });
  assert.deepEqual(H.getBaseline(dir), { grade: 'B', findings: 3, ts: 't1' });
  assert.equal(H.readHistory(dir).runs.length, 1);                // runs preserved
  H.setBaseline(dir, { grade: 'A', findings: 0, ts: 't2' });      // overwrites
  assert.equal(H.getBaseline(dir).grade, 'A');
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

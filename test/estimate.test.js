'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const E = require('../src/estimate');

const NO_HOME = p => path.join(p, 'NO_HOME');

test('deriveInputs: defaults when no signals', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(420)); // 420 / 4.2 (.md) = 100 tok per-spawn
  const inp = E.deriveInputs(dir, NO_HOME(dir), {});
  assert.equal(inp.perSpawnOverhead, 100);
  assert.equal(inp.perSessionOverhead, 0);
  assert.equal(inp.spawnsPerRun, 5);   // default
  assert.equal(inp.turnsPerAgent, 8);  // default
  assert.equal(inp.toolOutputWeight, 'low'); // no compute signals
  rm(dir);
});

test('deriveInputs: derives from command file signals', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  writeFile(dir, '.claude/commands/run.md',
    'spawn 3 subagents\n## Step 1\n## Step 2\n## Step 3\n## Step 4\nbuild, docker, sweep, then read the test suite log');
  const inp = E.deriveInputs(dir, NO_HOME(dir), {});
  assert.equal(inp.spawnsPerRun, 3);   // explicit "3 subagents"
  assert.equal(inp.turnsPerAgent, 4);  // 4 Step headers
  assert.equal(inp.toolOutputWeight, 'high'); // build,docker,sweep,"test suite",log = 5 hits (>=4)
  rm(dir);
});

test('deriveInputs: flags override derivation', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  const inp = E.deriveInputs(dir, NO_HOME(dir), { spawns: 2, turns: 6, toolout: 'med' });
  assert.equal(inp.spawnsPerRun, 2);
  assert.equal(inp.turnsPerAgent, 6);
  assert.equal(inp.toolOutputWeight, 'med');
  assert.equal(inp.toolOutputTokens, 6000);
  rm(dir);
});

test('computeBill: exact for known inputs', () => {
  const inp = { perSpawnOverhead: 100, perSessionOverhead: 0,
                spawnsPerRun: 5, turnsPerAgent: 8, toolOutputTokens: 6000 };
  const bill = E.computeBill(inp);
  assert.equal(bill.write, 500);       // 5*100 + 0
  assert.equal(bill.read, 244000);     // 5*(100+6000)*8
  assert.equal(bill.output, 14000);    // 5*8*350
  assert.equal(bill.total, 258500);
});

test('weight: applies price multipliers', () => {
  const w = E.weight({ write: 500, read: 244000, output: 14000 });
  assert.equal(w.write, 625);          // 500*1.25
  assert.equal(w.read, 24400);         // 244000*0.1
  assert.equal(w.output, 14000);       // 14000*1.0
  assert.equal(w.total, 39025);
});

test('applyFixes: L6 trims perSpawnOverhead, L8 drops toolout', () => {
  const inp = { perSpawnOverhead: 1000, perSessionOverhead: 0,
                spawnsPerRun: 5, turnsPerAgent: 8, toolOutputTokens: 18000,
                toolOutputWeight: 'high' };
  const out = E.applyFixes(inp, [6, 8], { perSpawnTrim: 0.5 });
  assert.equal(out.perSpawnOverhead, 500);      // L6: halved
  assert.equal(out.toolOutputTokens, 1500);     // L8: -> low
});

test('savings: ranks levers by weighted saving, no additive double-count', () => {
  const inp = { perSpawnOverhead: 1000, perSessionOverhead: 0,
                spawnsPerRun: 5, turnsPerAgent: 8, toolOutputTokens: 18000,
                toolOutputWeight: 'high' };
  const r = E.savings(inp, [6, 8]);
  assert.ok(r.postfixWeighted.total < r.baselineWeighted.total);
  assert.ok(r.savers.length >= 1);
  for (let i = 1; i < r.savers.length; i++)
    assert.ok(r.savers[i - 1].weightedSaved >= r.savers[i].weightedSaved);
  assert.equal(typeof r.note, 'string');
});

function capture(fn) {
  const orig = console.log; let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { fn(); } finally { console.log = orig; }
  return out;
}

test('runEstimate --json emits assumptions + bill.raw + bill.weighted + savers', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  const out = capture(() => E.runEstimate({ dir, json: true, _home: NO_HOME(dir) }));
  const j = JSON.parse(out);
  assert.ok(j.assumptions.spawnsPerRun);
  assert.ok(j.bill.raw.total > 0);
  assert.ok(j.bill.weighted.total > 0);
  assert.ok(Array.isArray(j.savers));
  rm(dir);
});

test('runEstimate human output carries the ESTIMATE label + assumptions', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  const out = capture(() => E.runEstimate({ dir, _home: NO_HOME(dir) }));
  assert.match(out, /ESTIMATE — model, not measurement/);
  assert.match(out, /Assumptions/);
  assert.match(out, /Run `audit`/);
  rm(dir);
});

test('runEstimate flags levers from review findings (not a fixed list)', () => {
  const dir = tmpDir();
  // 300-line CLAUDE.md -> Lever 6 flagged; no tool signals -> Lever 8 NOT flagged
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
  const out = capture(() => E.runEstimate({ dir, json: true, _home: NO_HOME(dir) }));
  const j = JSON.parse(out);
  const levers = j.savers.map(s => s.lever);
  assert.ok(levers.includes(6));
  assert.ok(!levers.includes(8));
  rm(dir);
});

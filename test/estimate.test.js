'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const E = require('../src/estimate');

const NO_HOME = p => path.join(p, 'NO_HOME');

test('deriveInputs: defaults when no signals', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400)); // 100 tok per-spawn
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

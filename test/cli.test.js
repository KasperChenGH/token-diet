'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');

test('estimate --json runs end-to-end on a fixture', () => {
  const dir  = tmpDir();
  const home = tmpDir();                 // empty home → no global ~/.claude bleeds into the bill
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  const env  = { ...process.env, HOME: home, USERPROFILE: home }; // os.homedir(): HOME (POSIX) / USERPROFILE (win)
  const out  = execFileSync('node',
    [BIN, 'estimate', '--dir', dir, '--spawns', '5', '--turns', '8', '--toolout', 'med', '--json'],
    { encoding: 'utf8', env });
  const j = JSON.parse(out);
  assert.equal(j.assumptions.spawnsPerRun, 5);
  assert.equal(j.bill.raw.read, 244000);  // 5*(100+6000)*8, deterministic with empty home
  rm(dir); rm(home);
});

test('help lists estimate', () => {
  const out = execFileSync('node', [BIN, '--help'], { encoding: 'utf8' });
  assert.match(out, /estimate/);
});

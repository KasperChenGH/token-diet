'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, rm } = require('./helpers');
const { runInit } = require('../src/init');

// runInit prints a lot; silence it so the test output stays readable.
async function silentInit(opts) {
  const orig = console.log;
  console.log = () => {};
  try { await runInit(opts); } finally { console.log = orig; }
}

test('runInit deploys a self-contained subagent (rubric + private knowledge + shared inlined)', async () => {
  const dir = tmpDir();
  await silentInit({ dir });

  const dig = fs.readFileSync(path.join(dir, '.claude', 'agents', 'subagent-digester.md'), 'utf8');
  assert.match(dig, /## Rubric \(inlined at install/);
  assert.match(dig, /Tier the Knowledge/);                       // rubric body present
  assert.match(dig, /## Private knowledge \(inlined at install\)/);
  assert.match(dig, /## Shared: specialist-contract/);
  assert.match(dig, /## Shared: information-preservation/);      // referenced via [[shared/...]]

  // Core artifacts deployed
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'agents', 'token-diet.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'commands', 'token-diet.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'token-diet', 'SKILL.md')));
  rm(dir);
});

test('runInit honors --dir (installs under the given path, not cwd)', async () => {
  const dir = tmpDir();
  await silentInit({ dir });
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'agents', 'token-diet.md')),
    'expected install under the --dir target');
  rm(dir);
});

test('runInit is idempotent — composed output is byte-stable across runs', async () => {
  const dir = tmpDir();
  await silentInit({ dir });
  const target = path.join(dir, '.claude', 'agents', 'subagent-digester.md');
  const first = fs.readFileSync(target, 'utf8');
  await silentInit({ dir });                 // second run
  const second = fs.readFileSync(target, 'utf8');
  assert.equal(first, second);
  rm(dir);
});

test('project init VENDORS the zero-dep CLI (self-contained, no global needed)', async () => {
  const dir = tmpDir();
  await silentInit({ dir });                                   // project mode (no --global)
  const cli = path.join(dir, '.claude', 'token-diet', 'bin', 'token-diet.js');
  assert.ok(fs.existsSync(cli), 'bin vendored');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'token-diet', 'src', 'review.js')), 'src vendored');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'token-diet', 'package.json')), 'package.json vendored');
  // the vendored CLI must actually run standalone
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
  assert.match(out, /token-diet/);
  rm(dir);
});

test('global init does NOT vendor the CLI (relies on the global binary)', async () => {
  const dir = tmpDir();
  await silentInit({ dir, global: true, _home: dir });        // global mode
  // --global installs under homedir/.claude, not dir/.claude; either way, no vendored CLI dir
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'token-diet', 'bin')), 'global must not vendor');
  rm(dir);
});

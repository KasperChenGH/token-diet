'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const R = require('../src/review');

const NO_HOME = p => path.join(p, 'NO_HOME');

function bigClaude(lines) { return Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n'); }

test('analyze: a 300-line CLAUDE.md produces a Lever 6 finding and a letter grade', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', bigClaude(300));
  const a = R.analyze(dir, NO_HOME(dir));
  assert.ok(Array.isArray(a.findings));
  assert.ok(a.findings.some(f => f.lever === 6), 'expected a Lever 6 finding');
  assert.match(a.grade, /^[A-F]$/);
  rm(dir);
});

test('checkLever8: flags test/build/log mention with no PostToolUse hook; clears with a hook', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(40));
  writeFile(dir, '.claude/commands/run.md', 'run the test suite and build the log');
  let a = R.analyze(dir, NO_HOME(dir));
  assert.ok(a.findings.some(f => f.lever === 8), 'expected a Lever 8 risk finding');

  writeFile(dir, '.claude/settings.json', JSON.stringify({ hooks: { PostToolUse: [{ matcher: '*' }] } }));
  a = R.analyze(dir, NO_HOME(dir));
  assert.ok(!a.findings.some(f => f.lever === 8), 'hook present -> no Lever 8 finding');
  rm(dir);
});

test('grade denominator is 8 levers (LEVER_NAMES has 8)', () => {
  assert.equal(Object.keys(R.LEVER_NAMES).length, 8);
});

test('checkVerbose: large low-heading file is flagged likely-verbose', () => {
  const dir = tmpDir();
  const body = '# Title\n' + Array.from({ length: 200 }, () => 'lots of words here and there').join('\n');
  writeFile(dir, '.claude/commands/big.md', body);
  const a = R.analyze(dir, NO_HOME(dir));
  assert.ok(a.findings.some(f => f.lever === 6 && /verbose/i.test(f.evidence)), 'expected a verbose flag');
  rm(dir);
});

const O = require('../src/overhead');
test('overhead prints a deprecation note and the per-spawn total', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  let out = '';
  const orig = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { O.runOverhead({ dir, _home: NO_HOME(dir) }); } finally { console.log = orig; }
  assert.match(out, /now part of `review`/);
  assert.match(out, /per-spawn/i);
  rm(dir);
});

const S = require('../src/scan');
test('fable is no longer a detected family or a top tier', () => {
  assert.equal(S.modelFamily('claude-fable-5'), 'other');
  assert.equal(R.modelTier('claude-fable-5'), 'other');   // not 'top'
  assert.equal(R.modelTier('claude-opus-4-8'), 'top');    // opus stays top
});

// The Lever 6 size finding (carries "tokens)" in its evidence), distinct from the verbose flag.
const sizeFinding = a => a.findings.find(f => f.lever === 6 && /tokens\)/.test(f.evidence));

test('Lever 6 size threshold boundary: 100 lines not flagged, 101 flagged', () => {
  const d100 = tmpDir(); writeFile(d100, 'CLAUDE.md', bigClaude(100));
  assert.ok(!sizeFinding(R.analyze(d100, NO_HOME(d100))), '100 lines must not trip the size finding');
  rm(d100);
  const d101 = tmpDir(); writeFile(d101, 'CLAUDE.md', bigClaude(101));
  assert.ok(sizeFinding(R.analyze(d101, NO_HOME(d101))), '101 lines must trip it');
  rm(d101);
});

test('Lever 6 severity boundary: 250 lines → med, 251 → high', () => {
  const d250 = tmpDir(); writeFile(d250, 'CLAUDE.md', bigClaude(250));
  assert.equal(sizeFinding(R.analyze(d250, NO_HOME(d250))).severity, 'med');
  rm(d250);
  const d251 = tmpDir(); writeFile(d251, 'CLAUDE.md', bigClaude(251));
  assert.equal(sizeFinding(R.analyze(d251, NO_HOME(d251))).severity, 'high');
  rm(d251);
});

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

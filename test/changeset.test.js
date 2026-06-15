'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const CH = require('../src/changeset');
const NO_HOME = p => path.join(p, 'NO_HOME');

test('buildChangeset: big CLAUDE.md -> move op skeleton (L6) with est saving', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
  const cs = CH.buildChangeset(dir, NO_HOME(dir));
  const move = cs.items.find(i => i.op === 'move');
  assert.ok(move, 'expected a move item');
  assert.equal(move.from, 'CLAUDE.md');
  assert.equal(move.to, 'CLAUDE-reference.md');
  assert.equal(move.region.fromLine, 91);
  assert.ok(move.region.toLine >= 300);
  assert.equal(typeof move.est_saved_weighted, 'number');
  assert.ok(cs.items.every(i => typeof i.id === 'number'));
  rm(dir);
});

test('buildChangeset: tool signals + no hook -> scaffold op skeleton (L8)', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(40));
  writeFile(dir, '.claude/commands/run.md', 'run the test suite and build the log');
  const cs = CH.buildChangeset(dir, NO_HOME(dir));
  assert.ok(cs.items.some(i => i.op === 'scaffold' && i.template === 'toolout-filter'));
  rm(dir);
});

test('buildChangeset: skips lever-6 summary findings whose file is a directory', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
  const cs = CH.buildChangeset(dir, NO_HOME(dir));
  assert.ok(cs.items.every(i => !i.from || i.from.endsWith('.md')));
  rm(dir);
});

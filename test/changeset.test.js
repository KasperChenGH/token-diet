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

test('buildChangeset: L6 move stub is a pointer + N-line preview (not a bare reference)', () => {
  const dir = tmpDir();
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
  lines[90] = '## Deep section heading';   // first moved line (region starts at line 91 = index 90)
  lines[91] = 'first body line of the moved region';
  writeFile(dir, 'CLAUDE.md', lines.join('\n'));
  const cs = CH.buildChangeset(dir, NO_HOME(dir));
  const move = cs.items.find(i => i.op === 'move');
  assert.match(move.pointer, /^# Deep Reference/);                  // stable first line (idempotency)
  assert.match(move.pointer, /Moved to `CLAUDE-reference\.md`/);    // path pointer
  assert.match(move.pointer, /> Deep section heading/);            // preview line (heading markup stripped)
  assert.match(move.pointer, /> first body line of the moved region/);
  assert.match(move.pointer, /\+\d+ more lines/);                  // remainder count
  rm(dir);
});

test('buildPointer is pointer-only when the source is unreadable (fail-safe)', () => {
  const p = CH.buildPointer('/no/such/file.md', { fromLine: 91, toLine: 200 }, 'ref.md');
  assert.match(p, /^# Deep Reference/);
  assert.match(p, /Full content: `ref\.md`/);
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

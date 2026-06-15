'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const F = require('../src/fix');

test('applyMove: content lands in dest BEFORE source loses it; source gets pointer', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'line1\nline2\nline3\nline4\nline5');
  const item = { id: 1, op: 'move', from: 'CLAUDE.md',
                 region: { fromLine: 2, toLine: 3 }, to: 'ref.md', pointer: 'POINTER' };
  const res = F.applyMove(item, dir);
  assert.equal(res.status, 'moved');
  const dest = fs.readFileSync(path.join(dir, 'ref.md'), 'utf8');
  assert.match(dest, /line2/); assert.match(dest, /line3/);     // moved content preserved
  const src = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(src, 'line1\nPOINTER\nline4\nline5');            // region replaced by pointer
  assert.doesNotMatch(src, /line2/);
  rm(dir);
});

test('applyMove: idempotent (pointer already present -> skip)', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'line1\nline2\nline3\nline4\nline5');
  const item = { id: 1, op: 'move', from: 'CLAUDE.md',
                 region: { fromLine: 2, toLine: 3 }, to: 'ref.md', pointer: 'POINTER' };
  F.applyMove(item, dir);
  const res2 = F.applyMove(item, dir);
  assert.match(res2.status, /skipped/);
  rm(dir);
});

test('applyWrite: writes new file; refuses clobber unless overwrite', () => {
  const dir = tmpDir();
  const item = { id: 2, op: 'write', to: 'knowledge/d.md', content: 'DIGEST' };
  assert.equal(F.applyWrite(item, dir).status, 'wrote');
  assert.equal(fs.readFileSync(path.join(dir, 'knowledge/d.md'), 'utf8'), 'DIGEST');
  assert.match(F.applyWrite(item, dir).status, /skipped/);              // exists, no overwrite
  assert.equal(F.applyWrite({ ...item, overwrite: true, content: 'NEW' }, dir).status, 'wrote');
  assert.equal(fs.readFileSync(path.join(dir, 'knowledge/d.md'), 'utf8'), 'NEW');
  rm(dir);
});

test('applyScaffold: writes a named template, skips if exists', () => {
  const dir = tmpDir();
  const item = { id: 3, op: 'scaffold', template: 'toolout-filter', to: 'scripts/f.sh', disabled: true };
  const res = F.applyScaffold(item, dir);
  assert.match(res.status, /scaffolded/);
  assert.ok(fs.existsSync(path.join(dir, 'scripts/f.sh')));
  assert.match(F.applyScaffold(item, dir).status, /skipped/);
  rm(dir);
});

test('applyScaffold: unknown template is an error, not a silent empty file', () => {
  const dir = tmpDir();
  const res = F.applyScaffold({ id: 9, op: 'scaffold', template: 'nope', to: 'x.sh' }, dir);
  assert.match(res.status, /ERROR/);
  rm(dir);
});

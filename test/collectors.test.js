'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const C = require('../src/collectors');

test('collectOverhead sums per-spawn (CLAUDE.md+skills) and per-session (commands)', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));                      // 400 bytes -> 100 tok
  writeFile(dir, '.claude/skills/s/SKILL.md', 'y'.repeat(800));      // 800 bytes -> 200 tok
  writeFile(dir, '.claude/commands/c.md', 'z'.repeat(1200));         // 1200 bytes -> 300 tok
  const oh = C.collectOverhead(dir, path.join(dir, 'NO_HOME'));      // empty home
  assert.equal(oh.perSpawnTotal, 300);   // 100 + 200
  assert.equal(oh.perSessionTotal, 300); // commands
  rm(dir);
});

test('collectCommandFiles returns command/agent/skill files with content', () => {
  const dir = tmpDir();
  writeFile(dir, '.claude/commands/c.md', 'spawn 3 subagents');
  const files = C.collectCommandFiles(dir, path.join(dir, 'NO_HOME'));
  assert.equal(files.length, 1);
  assert.match(files[0].content, /spawn 3 subagents/);
  rm(dir);
});

test('regexes match expected signals', () => {
  assert.match('spawn 3 subagents', new RegExp(C.SPAWN_RE.source, 'i'));
  assert.match('## Step 4: do', new RegExp(C.STEP_RE.source, 'im'));
  assert.match('run the test suite', new RegExp(C.TOOLOUT_RE.source, 'i'));
});

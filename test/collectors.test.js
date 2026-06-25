'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const C = require('../src/collectors');

test('collectOverhead sums per-spawn (CLAUDE.md+skills) and per-session (commands)', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));                      // 400 bytes / 4.2 (.md) -> 95 tok
  writeFile(dir, '.claude/skills/s/SKILL.md', 'y'.repeat(800));      // 800 / 4.2 -> 190 tok
  writeFile(dir, '.claude/commands/c.md', 'z'.repeat(1200));         // 1200 / 4.2 -> 286 tok
  const oh = C.collectOverhead(dir, path.join(dir, 'NO_HOME'));      // empty home
  assert.equal(oh.perSpawnTotal, 285);   // 95 + 190 (per-extension md ratio)
  assert.equal(oh.perSessionTotal, 286); // commands
  rm(dir);
});

test('estTokens uses per-extension chars/token ratios (md looser, json tighter)', () => {
  const dir = tmpDir();
  writeFile(dir, 'a.md', 'x'.repeat(420));     // 420 / 4.2 = 100
  writeFile(dir, 'a.json', 'x'.repeat(320));   // 320 / 3.2 = 100
  writeFile(dir, 'a.js', 'x'.repeat(380));     // 380 / 3.8 = 100
  writeFile(dir, 'a.bin', 'x'.repeat(400));    // 400 / 4.0 (_default) = 100
  assert.equal(C.estTokens(path.join(dir, 'a.md')), 100);
  assert.equal(C.estTokens(path.join(dir, 'a.json')), 100);
  assert.equal(C.estTokens(path.join(dir, 'a.js')), 100);
  assert.equal(C.estTokens(path.join(dir, 'a.bin')), 100);
  assert.equal(C.charsPerToken('x.md'), 4.2);
  assert.equal(C.charsPerToken('x.unknown'), 4.0);
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

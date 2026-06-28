'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, rm } = require('./helpers');
const S = require('../src/setup');
const R = require('../src/review');

// Isolate global ~/.claude so the filter install can't read/write a real one.
const HOME = tmpDir();
process.env.HOME = HOME; process.env.USERPROFILE = HOME;
async function silent(fn) { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } }

test('installPreCommit: skips cleanly when not a git repo', () => {
  const root = tmpDir();
  assert.equal(S.installPreCommit(root).ok, false);
  rm(root);
});

test('installPreCommit: creates the hook in a git repo and is idempotent', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  assert.ok(S.installPreCommit(root).ok);
  const hookP = path.join(root, '.git', 'hooks', 'pre-commit');
  assert.match(fs.readFileSync(hookP, 'utf8'), /token-diet review/);
  assert.equal(S.installPreCommit(root).status, 'already present');           // idempotent
  assert.equal((fs.readFileSync(hookP, 'utf8').match(/drift reminder/g) || []).length, 1);  // block added once
  rm(root);
});

test('installPreCommit: appends to an existing pre-commit hook (preserves it)', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nnpm test\n');
  assert.match(S.installPreCommit(root).status, /appended/);
  const hook = fs.readFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.match(hook, /npm test/);            // existing content preserved
  assert.match(hook, /token-diet review/);   // ours added
  rm(root);
});

test('runSetup wires BOTH hooks (filter + readgate) in AUDIT + the pre-commit hook', async () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  await silent(() => S.runSetup({ dir: root }));
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'toolout', 'filter.json'), 'utf8'));
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.mode, 'audit');           // recording, output unchanged — not auto-live
  const gate = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'readgate', 'config.json'), 'utf8'));
  assert.equal(gate.enabled, true);
  assert.equal(gate.mode, 'audit');          // readgate moves in lockstep with the filter
  assert.ok(fs.existsSync(path.join(root, '.git', 'hooks', 'pre-commit')));
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(set.hooks.PostToolUse.some(h => h.hooks.some(x => x.command === 'token-diet filter')));
  assert.ok(set.hooks.PreToolUse.some(h => h.hooks.some(x => x.command === 'token-diet readgate')));
  rm(root);
});

test('installPreCommit upgrades a stale single-line hook to the smart resolver (regression)', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
  const hookP = path.join(root, '.git', 'hooks', 'pre-commit');
  // the pre-vendoring single-line form
  fs.writeFileSync(hookP, '#!/bin/sh\nnpm test\n# token-diet review (drift reminder)\ncommand -v token-diet >/dev/null 2>&1 && token-diet review --dir .\n');
  const r = S.installPreCommit(root);
  assert.match(r.status, /upgraded/);
  const after = fs.readFileSync(hookP, 'utf8');
  assert.match(after, /npm test/);                                   // foreign content preserved
  assert.match(after, /\.claude\/token-diet\/bin\/token-diet\.js/);  // smart resolver now present
  assert.equal((after.match(/drift reminder/g) || []).length, 1);    // not duplicated
  assert.doesNotMatch(after, /command -v token-diet >\/dev\/null 2>&1 && token-diet review --dir \.\n/);  // old line gone
  assert.equal(S.installPreCommit(root).status, 'already present');  // idempotent after upgrade
  rm(root);
});

test('runSetup --activate brings the WHOLE stack LIVE in one command (filter + readgate active)', async () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  await silent(() => S.runSetup({ dir: root, activate: true }));
  const cfg  = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'toolout', 'filter.json'), 'utf8'));
  const gate = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'readgate', 'config.json'), 'utf8'));
  assert.equal(cfg.mode, 'active');          // --activate goes straight live...
  assert.equal(gate.mode, 'active');         // ...for both hooks — hands-off, one command
  rm(root);
});

test('gradeWorseThan gates the --fail-under CI check', () => {
  assert.equal(R.gradeWorseThan('D', 'C'), true);     // D is worse than C → fail
  assert.equal(R.gradeWorseThan('B', 'C'), false);    // B is better → pass
  assert.equal(R.gradeWorseThan('C', 'C'), false);    // equal is not worse
  assert.equal(R.gradeWorseThan('F', 'A'), true);
  assert.equal(R.gradeWorseThan('N/A', 'C'), false);  // no project artifacts → never fails
});

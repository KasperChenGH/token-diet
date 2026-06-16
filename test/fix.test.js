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

test('applyCommentMarker: inserts after frontmatter; idempotent', () => {
  const dir = tmpDir();
  writeFile(dir, '.claude/agents/x.md', '---\nname: x\n---\nbody');
  const item = { id: 4, op: 'comment-marker', file: '.claude/agents/x.md',
                 anchor: 'top', text: '<!-- token-diet: removal candidate -->' };
  assert.equal(F.applyCommentMarker(item, dir).status, 'inserted');
  const out = fs.readFileSync(path.join(dir, '.claude/agents/x.md'), 'utf8');
  assert.equal(out, '---\nname: x\n---\n<!-- token-diet: removal candidate -->\nbody');
  assert.match(F.applyCommentMarker(item, dir).status, /skipped/);
  rm(dir);
});

test('runFix: a changeset path escaping the project root is rejected (traversal guard)', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'a\nb\nc');
  changeset(dir, [{ id: 1, op: 'write', to: '../evil.md', content: 'x' }]);
  const res = F.runFix({ dir, changeset: path.join(dir, 'diet-changeset.json'), json: true, _silent: true });
  assert.match(res[0].status, /ERROR/);
  assert.equal(fs.existsSync(path.join(dir, '..', 'evil.md')), false);   // nothing written outside root
  rm(dir);
});

test('applyMove: out-of-range region is an error, not a silent empty/wrong move', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'l1\nl2\nl3');                 // 3 lines
  const res = F.applyMove({ id: 1, op: 'move', from: 'CLAUDE.md',
                            region: { fromLine: 5, toLine: 9 }, to: 'ref.md', pointer: 'P' }, dir);
  assert.match(res.status, /ERROR region out of range/);
  assert.equal(fs.existsSync(path.join(dir, 'ref.md')), false);   // nothing written
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'l1\nl2\nl3'); // source untouched
  rm(dir);
});

test('applyMove: idempotency uses the first NON-empty pointer line (no double-apply)', () => {
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', 'l1\nl2\nl3\nl4');
  const item = { id: 1, op: 'move', from: 'CLAUDE.md', region: { fromLine: 2, toLine: 3 },
                 to: 'ref.md', pointer: '\n<!-- moved to ref.md -->' };   // empty first line
  assert.equal(F.applyMove(item, dir).status, 'moved');
  assert.match(F.applyMove(item, dir).status, /skipped/);   // 2nd run must NOT re-append
  assert.equal((fs.readFileSync(path.join(dir, 'ref.md'), 'utf8').match(/l2/g) || []).length, 1);
  rm(dir);
});

function changeset(dir, items) { writeFile(dir, 'diet-changeset.json', JSON.stringify({ items })); }

test('runFix: applies all, --only filters, --dry-run writes nothing', () => {
  const dir = tmpDir();
  writeFile(dir, 'a.md', 'A');
  writeFile(dir, 'b.md', 'B');
  changeset(dir, [
    { id: 1, op: 'write', to: 'out1.md', content: '1' },
    { id: 2, op: 'write', to: 'out2.md', content: '2' },
  ]);
  const cs = path.join(dir, 'diet-changeset.json');

  const dry = F.runFix({ dir, changeset: cs, dryRun: true, json: true, _silent: true });
  assert.ok(dry.every(r => /dry-run/.test(r.status)));
  assert.equal(fs.existsSync(path.join(dir, 'out1.md')), false);

  const only = F.runFix({ dir, changeset: cs, only: '2', json: true, _silent: true });
  assert.equal(only.length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'out2.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'out1.md')), false);
  rm(dir);
});

test('runVerify: flags dangling Uses: pointer; passes when resolved', () => {
  const dir = tmpDir();
  writeFile(dir, '.claude/agents/x.md', '---\nname: x\n---\nUses: [[shared/contract]]');
  changeset(dir, [{ id: 1, op: 'write', to: '.claude/agents/x.md', content: 'x' }]);
  const cs = path.join(dir, 'diet-changeset.json');

  const bad = F.runVerify({ dir, changeset: cs, _silent: true });
  assert.ok(bad.some(p => /shared\/contract/.test(p)));      // missing shared skill

  writeFile(dir, 'skills/shared/contract.md', '# contract');
  const good = F.runVerify({ dir, changeset: cs, _silent: true });
  assert.equal(good.length, 0);
  rm(dir);
});

test('runVerify: flags unterminated frontmatter', () => {
  const dir = tmpDir();
  writeFile(dir, '.claude/agents/y.md', '---\nname: y\nbody-without-close');
  changeset(dir, [{ id: 1, op: 'write', to: '.claude/agents/y.md', content: 'y' }]);
  const probs = F.runVerify({ dir, changeset: path.join(dir, 'diet-changeset.json'), _silent: true });
  assert.ok(probs.some(p => /frontmatter/.test(p)));
  rm(dir);
});

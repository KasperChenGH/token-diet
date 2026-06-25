'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

// Isolate global ~/.claude BEFORE requiring the module.
const HOME = tmpDir();
process.env.HOME = HOME; process.env.USERPROFILE = HOME;
const R = require('../src/readgate');

// Helper: write readgate config under a root.
function cfg(root, obj) {
  writeFile(root, '.claude/readgate/config.json', JSON.stringify({ ...R.DEFAULT_CONFIG, ...obj }));
}
// Helper: a Read payload for an on-disk file.
function readOf(root, rel, sid = 's1', extra = {}) {
  return { session_id: sid, tool_name: 'Read', cwd: root,
           tool_input: { file_path: path.join(root, rel), ...extra } };
}
const T0 = '2026-06-25T10:00:00.000Z';
const T1 = '2026-06-25T10:05:00.000Z';   // +5 min  (within ttl 120)
const TLATE = '2026-06-25T13:30:00.000Z'; // +3.5 h  (past ttl 120)

test('pure helpers: estTok, rangeKey, isUnchanged, withinTtl', () => {
  assert.equal(R.estTok(2000), 500);
  assert.equal(R.rangeKey({ file_path: '/a', offset: 5, limit: 50 }), '/a|5|50');
  assert.equal(R.rangeKey({ file_path: '/a' }), '/a||');
  assert.equal(R.isUnchanged({ mtimeMs: 1, size: 9 }, { mtimeMs: 1, size: 9 }), true);
  assert.equal(R.isUnchanged({ mtimeMs: 1, size: 9 }, { mtimeMs: 2, size: 9 }), false);
  assert.equal(R.withinTtl(T0, T1, 120), true);
  assert.equal(R.withinTtl(T0, TLATE, 120), false);
});

test('disabled gate → null and no state written', () => {
  const root = tmpDir();
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  // no config at all → disabled by default
  assert.equal(R.decide(readOf(root, 'big.txt'), root, T0), null);
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'readgate', 'seen')), 'no state when disabled');
  rm(root);
});

test('non-Read tool → null', () => {
  const root = tmpDir(); cfg(root, { enabled: true });
  const p = { session_id: 's1', tool_name: 'Bash', cwd: root, tool_input: { command: 'ls' } };
  assert.equal(R.decide(p, root, T0), null);
  rm(root);
});

test('first read of a large file → allow (null) and records state', () => {
  const root = tmpDir(); cfg(root, { enabled: true });
  writeFile(root, 'big.txt', 'x'.repeat(2000));               // 500 tok > minTokens 400
  assert.equal(R.decide(readOf(root, 'big.txt'), root, T0), null);
  const state = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'readgate', 'seen', 's1.json'), 'utf8'));
  const key = path.join(root, 'big.txt') + '||';
  assert.ok(state[key], 'state recorded for first read');
  assert.equal(state[key].tok, 500);
  rm(root);
});

test('sub-minTokens read → allow and NOT recorded', () => {
  const root = tmpDir(); cfg(root, { enabled: true });
  writeFile(root, 'small.txt', 'x'.repeat(400));              // 100 tok < 400
  assert.equal(R.decide(readOf(root, 'small.txt'), root, T0), null);
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'readgate', 'seen', 's1.json')), 'tiny read not tracked');
  rm(root);
});

test('audit: redundant unchanged re-read → null but records a stat', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'audit' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  R.decide(readOf(root, 'big.txt'), root, T0);                // first read
  assert.equal(R.decide(readOf(root, 'big.txt'), root, T1), null, 'audit never denies');
  const stats = fs.readFileSync(path.join(root, '.claude', 'readgate', 'stats.jsonl'), 'utf8').trim().split('\n');
  assert.equal(stats.length, 1);
  assert.equal(JSON.parse(stats[0]).tok, 500);
  rm(root);
});

test('active: redundant unchanged re-read → deny JSON with file + reason', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  R.decide(readOf(root, 'big.txt'), root, T0);
  const out = R.decide(readOf(root, 'big.txt'), root, T1);
  assert.ok(out, 'expected a deny');
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /already in context/);
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /big\.txt/);
  rm(root);
});

test('changed file (size differs) → allow even within ttl', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  R.decide(readOf(root, 'big.txt'), root, T0);
  writeFile(root, 'big.txt', 'y'.repeat(2400));               // size changed
  assert.equal(R.decide(readOf(root, 'big.txt'), root, T1), null, 'modified file must be re-readable');
  rm(root);
});

test('past-ttl re-read → allow (treated as no longer in context)', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active', ttlMinutes: 120 });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  R.decide(readOf(root, 'big.txt'), root, T0);
  assert.equal(R.decide(readOf(root, 'big.txt'), root, TLATE), null, 'stale entry is not denied');
  rm(root);
});

test('different range (offset/limit) is a different entry → allow', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  R.decide(readOf(root, 'big.txt', 's1'), root, T0);                       // full read
  assert.equal(R.decide(readOf(root, 'big.txt', 's1', { offset: 50, limit: 10 }), root, T1), null);
  rm(root);
});

test('per-session isolation: another session is not deduped', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  R.decide(readOf(root, 'big.txt', 's1'), root, T0);
  assert.equal(R.decide(readOf(root, 'big.txt', 's2'), root, T1), null, 'session 2 has its own context');
  rm(root);
});

test('fail-open: missing file and malformed payload → null', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  assert.equal(R.decide(readOf(root, 'does-not-exist.txt'), root, T0), null);
  assert.equal(R.decide({ tool_name: 'Read' }, root, T0), null);          // no tool_input
  assert.equal(R.decide({}, root, T0), null);                            // empty
  rm(root);
});

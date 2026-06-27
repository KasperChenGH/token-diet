'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const C = require('../src/compact');

test('pickSession: --session prefix-matches; else most recent by timestamp', () => {
  const recs = [
    { file: '/p/aaa1.jsonl', timestamp: '2026-01-01T00:00:00Z' },
    { file: '/p/bbb2.jsonl', timestamp: '2026-06-01T00:00:00Z' },
  ];
  assert.equal(C.pickSession(recs, { session: 'aaa' }).file, '/p/aaa1.jsonl');
  assert.equal(C.pickSession(recs, {}).file, '/p/bbb2.jsonl');        // most recent
  assert.equal(C.pickSession(recs, { session: 'zzz' }), null);
});

test('extractArtifacts: files from Edit/Write, commits from git commit, next-steps from TodoWrite', () => {
  const recs = [
    { toolCalls: [{ name: 'Read', id: 'r', filePath: 'a.js' }] },          // read → not an artifact
    { toolCalls: [{ name: 'Edit', id: 'e', filePath: 'src/a.js' }] },
    { toolCalls: [{ name: 'Write', id: 'w', filePath: 'src/b.js' }] },
    { toolCalls: [{ name: 'Edit', id: 'e2', filePath: 'src/a.js' }] },     // dup → unique
  ];
  const meta = { toolCallsById: new Map([
    ['c', { name: 'Bash', input: { command: 'git commit -m "feat: x"' } }],
    ['t', { name: 'TodoWrite', input: { todos: [
      { content: 'done thing', status: 'completed' },
      { content: 'finish the parser', status: 'in_progress' },
      { content: 'write docs', status: 'pending' },
    ] } }],
  ]) };
  const a = C.extractArtifacts(recs, meta);
  assert.deepEqual(a.files.sort(), ['src/a.js', 'src/b.js']);
  assert.deepEqual(a.commits, ['feat: x']);
  assert.deepEqual(a.nextSteps, ['finish the parser', 'write docs']);     // completed dropped
});

test('renderHandover emits the three sections', () => {
  const md = C.renderHandover({ id: 'abc', intent: 'do the thing', files: ['x.js'], commits: ['feat: y'], nextSteps: ['next'], calls: 12 });
  assert.match(md, /## intent\ndo the thing/);
  assert.match(md, /## artifacts/);
  assert.match(md, /commit: feat: y/);
  assert.match(md, /## next-steps\n- \[ \] next/);
});

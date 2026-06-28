'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const C = require('../src/compact');

const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');

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

// Integration (regression): the opening prompt must survive scan's fast pre-filter AND the
// scanAll→fileMeta hand-off into compact's intent. This path silently broke once (firstUserText
// dropped between streamFile and scanAll), so it is locked end-to-end through the real binary.
test('compact extracts the real opening prompt as intent — skipping command/meta wrappers', () => {
  const home = tmpDir();
  const now  = new Date().toISOString();
  const lines = [
    JSON.stringify({ type: 'user', message: { content: '<local-command-caveat>Caveat: ran a local command' } }), // meta → skipped
    JSON.stringify({ type: 'user', message: { content: 'build the JSONL parser' } }),                             // the real intent
    JSON.stringify({ type: 'assistant', requestId: 'r1', timestamp: now, message: { model: 'claude-opus-4',
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
      content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/parser.js' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
  ].join('\n') + '\n';
  writeFile(home, '.claude/projects/proj/sess.jsonl', lines);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const out = execFileSync('node', [BIN, 'compact', '--session', 'sess', '--days', '3650'], { encoding: 'utf8', env });
  assert.match(out, /## intent\nbuild the JSONL parser/);   // captured the real prompt...
  assert.doesNotMatch(out, /local-command-caveat/);         // ...not the meta wrapper
  assert.match(out, /src[\/]parser\.js/);                  // artifact joined from the tool_use
  rm(home);
});

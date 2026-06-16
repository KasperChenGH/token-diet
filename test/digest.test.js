'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

// Isolate HOME so scanAll() reads our fixture transcripts, not the real ~/.claude.
const HOME = tmpDir();
process.env.HOME = HOME; process.env.USERPROFILE = HOME;

const D = require('../src/digest');
const silence = fn => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

test('extractSkeleton keeps signatures + headings, drops bodies', () => {
  const src = [
    '# Title',
    'some prose that should be dropped',
    'export function foo(a, b) {',
    '  const x = a + b;        // body line — dropped',
    '  return x;',
    '}',
    '## Section',
    'class Bar {',
    '  method() { return 1; }  // dropped',
    '}',
  ].join('\n');
  const out = D.extractSkeleton(src);
  assert.match(out, /# Title/);
  assert.match(out, /export function foo/);
  assert.match(out, /## Section/);
  assert.match(out, /class Bar/);
  assert.doesNotMatch(out, /prose that should be dropped/);
  assert.doesNotMatch(out, /const x = a \+ b/);
  assert.ok(out.split('\n').length < src.split('\n').length);
});

test('extractSkeleton parses Read output that carries line-number prefixes', () => {
  const src = '   1\texport function foo() {\n   2\t  return 1;\n   3\t}';
  assert.match(D.extractSkeleton(src), /export function foo/);
});

test('scaffoldOne writes a digest with a source pointer + skeleton', () => {
  const root = tmpDir();
  writeFile(root, 'src/foo.js', 'function alpha() {\n  doThing(noise);\n}\nclass Beta {}\n');
  const rel = D.scaffoldOne(root, { file: path.join(root, 'src', 'foo.js'), count: 5, tokens: 1234 });
  assert.equal(rel, '.claude/digests/src__foo.js.md');
  const body = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(body, /Digest: src[\\/]foo\.js/);
  assert.match(body, /read 5×/);
  assert.match(body, /1,234 tok/);
  assert.match(body, /function alpha/);
  assert.match(body, /class Beta/);
  assert.doesNotMatch(body, /noise/);          // body line not in the skeleton
  rm(root);
});

test('scaffoldOne skips files outside the project root or already gone', () => {
  const root = tmpDir();
  const outside = writeFile(tmpDir(), 'x.js', 'function q() {}');     // different tree
  assert.equal(D.scaffoldOne(root, { file: outside, count: 3, tokens: 9 }), null);
  assert.equal(D.scaffoldOne(root, { file: path.join(root, 'gone.js'), count: 3, tokens: 9 }), null);
  rm(root);
});

test('collectReadStats groups Read calls by file and sums tokens (ignores non-Read)', async () => {
  const slug = 'digestproj';
  const rd = (id, fp) => JSON.stringify({ type: 'assistant', requestId: 'r' + id, timestamp: '2026-06-10T00:00:00.000Z',
    message: { id: 'm' + id, model: 'claude-sonnet-4-6', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', id: 't' + id, name: fp ? 'Read' : 'Bash', input: fp ? { file_path: fp } : { command: 'ls' } }] } });
  const res = (id, text) => JSON.stringify({ type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't' + id, content: text }] } });
  const lines = [
    rd(1, '/proj/hot.js'), res(1, '0123456789012345'),   // 16 chars → 4 tok
    rd(2, '/proj/hot.js'), res(2, '0123456789012345'),   // again → 4 tok, count 2
    rd(3, '/proj/cold.js'), res(3, '01234567'),          // 8 chars → 2 tok
    rd(4, null),           res(4, 'some bash output here'),   // non-Read → ignored
  ].join('\n');
  writeFile(HOME, `.claude/projects/${slug}/s.jsonl`, lines);

  const stats = await D.collectReadStats({ project: slug, days: 0 });
  const hot = stats.find(s => s.file === '/proj/hot.js');
  assert.ok(hot, 'hot.js should be tracked');
  assert.equal(hot.count, 2);
  assert.equal(hot.tokens, 8);
  assert.equal(stats[0].file, '/proj/hot.js');             // sorted by tokens desc
  assert.ok(!stats.some(s => s.file == null), 'non-Read tools excluded');
});

test('runDigest with no candidates prints guidance and returns []', async () => {
  let out = ''; const o = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  let r;
  try { r = await D.runDigest({ project: 'no-such-project-xyz', days: 7, minReads: 99 }); }
  finally { console.log = o; }
  assert.deepEqual(r, []);
  assert.match(out, /nothing worth a digest/i);
});

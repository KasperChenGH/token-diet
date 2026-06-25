'use strict';
// The `agents` command's useful-work ratio + "READING NOT THINKING" flag is the product's
// headline metric, but it was only exercised for `calls`/array-length. These tests drive the
// --json path on fixture transcripts and assert the ratio, the 0.15 flag boundary, and the
// worst-first sort.
const { test }        = require('node:test');
const assert          = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path            = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');
const daysAgo = n => new Date(Date.now() - n * 86400_000).toISOString();

// One assistant usage record with explicit token counts. Unique requestId → never deduped.
function rec(reqId, sess, tok) {
  return JSON.stringify({
    type: 'assistant', requestId: reqId, timestamp: daysAgo(1), sessionId: sess,
    message: { model: 'claude-opus-4', usage: {
      input_tokens: tok.in || 0, cache_creation_input_tokens: tok.cw || 0,
      cache_read_input_tokens: tok.cr || 0, output_tokens: tok.out || 0 } },
  });
}

function runAgentsJson(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return JSON.parse(execFileSync('node', [BIN, 'agents', '--days', '7', '--json'], { encoding: 'utf8', env }));
}

test('agents --json computes ratio = output/(output+fresh_in+cache_write) and flags < 0.15', () => {
  const home = tmpDir();
  // low ratio: 10 / (10 + 10 + 100) = 0.0833 → flagged "READING NOT THINKING"
  writeFile(home, '.claude/projects/proj/lowratio.jsonl', rec('l1', 'low', { in: 10, cw: 100, cr: 500, out: 10 }) + '\n');
  // high ratio: 200 / (200 + 10 + 10) = 0.9091 → not flagged
  writeFile(home, '.claude/projects/proj/highratio.jsonl', rec('h1', 'high', { in: 10, cw: 10, cr: 50, out: 200 }) + '\n');

  const rows = runAgentsJson(home);
  const low  = rows.find(r => r.file.includes('lowratio'));
  const high = rows.find(r => r.file.includes('highratio'));

  assert.equal(low.ratio, 0.0833);                       // 10/120, 4dp
  assert.equal(low.flag, 'READING NOT THINKING');        // below the 0.15 boundary
  assert.equal(high.ratio, 0.9091);                      // 200/220, 4dp
  assert.equal(high.flag, '');                           // above the boundary → not flagged
  rm(home);
});

test('agents --json sorts worst-ratio-first', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/worst.jsonl', rec('w1', 'worst', { in: 10, cw: 100, cr: 9, out: 5 }) + '\n');  // ~0.043
  writeFile(home, '.claude/projects/proj/best.jsonl',  rec('b1', 'best',  { in: 1,  cw: 1,   cr: 9, out: 100 }) + '\n'); // ~0.980
  const rows = runAgentsJson(home);
  const iWorst = rows.findIndex(r => r.file.includes('worst'));
  const iBest  = rows.findIndex(r => r.file.includes('best'));
  assert.ok(iWorst < iBest, 'worst ratio must sort before best');
  assert.ok(rows[iWorst].ratio < rows[iBest].ratio);
  rm(home);
});

'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

// Isolate HOME so installId + any config writes don't touch the real ~/.claude.
const HOME = tmpDir();
process.env.HOME = HOME; process.env.USERPROFILE = HOME;

const S = require('../src/savings');

function project(root) {
  // a minimal heavy-ish project so estimate/review have something to chew on
  writeFile(root, '.claude/commands/x.md', '---\n---\nSpawn 5 subagents.\n## Step 1\n## Step 2\nrun the test suite, build, docker');
  writeFile(root, 'CLAUDE.md', 'x\n'.repeat(160));
}

test('computeSavings returns grade + projection + (optional) filter stats', () => {
  const root = tmpDir(); project(root);
  const d = S.computeSavings({ dir: root, _home: HOME });
  assert.ok(['A','B','C','D','F','N/A'].includes(d.grade));
  assert.ok(d.est && typeof d.est.pct === 'number');
  rm(root);
});

test('printTable warns about double-counting when both gates have measured activity', () => {
  const root = tmpDir(); project(root);
  writeFile(root, '.claude/toolout/stats.jsonl', JSON.stringify({ kind: 'tests', rawTok: 100, compTok: 40 }) + '\n');
  writeFile(root, '.claude/readgate/stats.jsonl', JSON.stringify({ file: 'a', tok: 50, mode: 'audit' }) + '\n');
  let buf = '';
  const o = console.log; console.log = (...a) => { buf += a.join(' ') + '\n'; };
  try { S.runSavings({ dir: root, _home: HOME }); } finally { console.log = o; }
  assert.match(buf, /do NOT add them/);
  rm(root);
});

test('share payload is STRICTLY AGGREGATE — no paths, names, content, or commands', () => {
  const root = tmpDir(); project(root);
  // seed measured filter stats so the filter branch is exercised
  writeFile(root, '.claude/toolout/stats.jsonl',
    JSON.stringify({ ts: 't', tool: 'Bash', kind: 'tests', rawTok: 1000, compTok: 120 }) + '\n');
  const d = S.computeSavings({ dir: root, _home: HOME });
  const payload = S.sharePayload(d);
  const blob = JSON.stringify(payload);

  // must NOT contain file paths, the project root, or artifact names (the schema constant
  // "token-diet/savings/1" is allowed — that's why we don't ban a bare "/").
  assert.doesNotMatch(blob, /CLAUDE\.md|\.claude|commands|\.md|[A-Za-z]:\\|\\\\/);
  assert.doesNotMatch(blob, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // must contain only the allowed aggregate keys
  const allowed = new Set(['schema','version','os','node','installId','grade',
    'projectedReductionPct','flaggedLevers','projectedSaversWeighted','filter']);
  for (const k of Object.keys(payload)) assert.ok(allowed.has(k), `unexpected key in payload: ${k}`);
  // filter sub-object carries only counts/pcts, never raw content
  if (payload.filter) for (const r of payload.filter.byKind)
    assert.deepEqual(Object.keys(r).sort(), ['calls','kind','pct']);
  rm(root);
});

test('githubIssueUrl encodes the payload into a new-issue link with the telemetry label', () => {
  const url = S.githubIssueUrl({ version: '0.7.0', grade: 'C', projectedReductionPct: 40 });
  assert.match(url, /^https:\/\/github\.com\/KasperChenGH\/token-diet\/issues\/new\?/);
  assert.match(url, /labels=telemetry/);
  assert.match(url, /body=/);
});

test('installId is stable across calls (written once, reused)', () => {
  const home = tmpDir();
  const a = S.installId(home);
  const b = S.installId(home);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);   // uuid shape
  rm(home);
});

test('runSavings --share --dry-run prints the payload and sends nothing', async () => {
  const root = tmpDir(); project(root);
  let out = ''; const o = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { await S.runSavings({ dir: root, _home: HOME, share: true, dryRun: true }); }
  finally { console.log = o; }
  assert.match(out, /aggregate-only/);
  assert.match(out, /\[--dry-run\] nothing sent/);
  assert.doesNotMatch(out, /github\.com.*issues\/new/);   // dry-run stops before the link/POST
  rm(root);
});

'use strict';
// scan.js is the core measurement parser — the requestId dedup is the project's
// headline correctness claim ("naive summing inflates totals 2-3×"). These are
// golden/characterization tests of that path, plus the threshold + regression cases.
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const S = require('../src/scan');

const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');
const isoNow      = () => new Date().toISOString();
const isoDaysAgo  = d  => new Date(Date.now() - d * 86400_000).toISOString();

function rec({ requestId, msgId, output = 0, ts, model = 'claude-opus-4' }) {
  const o = { type: 'assistant', timestamp: ts || isoNow(),
    message: { model, usage: {
      input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output } } };
  if (requestId !== undefined) o.requestId = requestId;
  if (msgId !== undefined) o.message.id = msgId;
  return JSON.stringify(o);
}
function agentsJson(home, extra = []) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return JSON.parse(execFileSync('node', [BIN, 'agents', '--json', ...extra], { encoding: 'utf8', env }));
}

// ── pure helpers ───────────────────────────────────────────────────────────────
test('modelFamily classifies known families, defaults to other (no-fable rule)', () => {
  assert.equal(S.modelFamily('claude-opus-4-8'), 'opus');
  assert.equal(S.modelFamily('claude-sonnet-4-6'), 'sonnet');
  assert.equal(S.modelFamily('claude-haiku-4-5'), 'haiku');
  assert.equal(S.modelFamily('claude-fable-5'), 'other');
  assert.equal(S.modelFamily(''), 'other');
  assert.equal(S.modelFamily('CLAUDE-OPUS'), 'opus');   // case-insensitive
});
test('sessionKind: agent- files are subagents, others are sessions', () => {
  assert.equal(S.sessionKind('agent-abc.jsonl'), 'subagent');
  assert.equal(S.sessionKind(path.join('x', 'y', 'uuid.jsonl')), 'session');
});

// ── requestId dedup (golden) ─────────────────────────────────────────────────────
test('requestId dedup: 3 duplicate lines count ONCE (not 3×)', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    [rec({ requestId: 'r1', output: 50 }),
     rec({ requestId: 'r1', output: 50 }),   // duplicate content block
     rec({ requestId: 'r1', output: 50 }),   // duplicate content block
     rec({ requestId: 'r2', output: 99 })].join('\n') + '\n');
  const agents = agentsJson(home);
  assert.equal(agents.length, 1);            // one session file
  assert.equal(agents[0].calls, 2);          // 2 distinct requestIds
  assert.equal(agents[0].output, 149);       // 50 + 99 — NOT 50*3 + 99 = 249
  rm(home);
});

// ── time-window threshold ────────────────────────────────────────────────────────
test('--days window excludes records older than the cutoff', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    [rec({ requestId: 'recent', output: 10, ts: isoNow() }),
     rec({ requestId: 'old',    output: 999, ts: isoDaysAgo(100) })].join('\n') + '\n');
  const agents = agentsJson(home, ['--days', '7']);
  assert.equal(agents[0].calls, 1);          // old excluded
  assert.equal(agents[0].output, 10);
  rm(home);
});

// ── regression: null-callId poisoning (fixed this session) ───────────────────────
test('regression: a filtered no-id line does not drop a later in-window no-id line', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    [rec({ output: 777, ts: isoDaysAgo(100) }),  // no requestId/id → callId null, filtered first
     rec({ output: 42,  ts: isoNow() })].join('\n') + '\n');   // recent no-id line must survive
  const agents = agentsJson(home, ['--days', '7']);
  assert.equal(agents.length, 1, 'recent no-id line was dropped — poisoning regression');
  assert.equal(agents[0].output, 42);
  rm(home);
});

// ── determinism ──────────────────────────────────────────────────────────────────
test('scan is deterministic: identical fixture → identical output', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    rec({ requestId: 'r1', output: 5 }) + '\n' + rec({ requestId: 'r2', output: 7 }) + '\n');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const a = execFileSync('node', [BIN, 'agents', '--json'], { encoding: 'utf8', env });
  const b = execFileSync('node', [BIN, 'agents', '--json'], { encoding: 'utf8', env });
  assert.equal(a, b);
  rm(home);
});

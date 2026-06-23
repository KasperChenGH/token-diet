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

// ── no-id dedup: synthesized key collapses one call's content-block lines ─────────
test('no-id lines sharing ts+usage count ONCE (not per content block)', () => {
  const home = tmpDir();
  const ts = isoNow();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    [rec({ output: 50, ts }),               // no requestId/id → key on ts+usage
     rec({ output: 50, ts }),               // same call's 2nd block → same key → deduped
     rec({ output: 99, ts })].join('\n') + '\n');  // different usage → distinct call
  const agents = agentsJson(home);
  assert.equal(agents[0].calls, 2);          // 2 distinct, NOT 3
  assert.equal(agents[0].output, 149);       // 50 + 99 — not 50 + 50 + 99
  rm(home);
});

// ── Phase 1: file-level mtime window-skip (perf; must stay behaviour-identical) ──
const fs = require('fs');

test('window-skip: a file whose mtime predates (cutoff - skew) is not opened', () => {
  // Artificial on purpose: the record is in-window, but the file's mtime is set
  // older than cutoff - 24h skew. Real append-only transcripts can't be in this
  // state; the test proves the mtime fast-skip actually fires (the in-window record
  // is excluded because the file was never opened).
  const home = tmpDir();
  const f = writeFile(home, '.claude/projects/proj/sess.jsonl',
    rec({ requestId: 'r1', output: 50, ts: isoNow() }) + '\n');
  const cutoff = Date.now() - 7 * 86400_000;
  const oldMtime = new Date(cutoff - 48 * 3600_000);   // 24h beyond the skew floor
  fs.utimesSync(f, oldMtime, oldMtime);
  // Skipped → zero records → agents prints its "No records" notice rather than JSON.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const out = execFileSync('node', [BIN, 'agents', '--json', '--days', '7'], { encoding: 'utf8', env });
  assert.match(out, /No records/, 'old-mtime file should be skipped without opening');
  rm(home);
});

test('window-skip: a file within the skew margin is still opened + line-filtered', () => {
  const home = tmpDir();
  const f = writeFile(home, '.claude/projects/proj/sess.jsonl',
    rec({ requestId: 'r1', output: 50, ts: isoNow() }) + '\n');
  const cutoff = Date.now() - 7 * 86400_000;
  const edgeMtime = new Date(cutoff - 1 * 3600_000);   // 1h past cutoff, inside 24h skew
  fs.utimesSync(f, edgeMtime, edgeMtime);
  const agents = agentsJson(home, ['--days', '7']);
  assert.equal(agents.length, 1, 'file inside skew margin must still be read');
  assert.equal(agents[0].output, 50);
  rm(home);
});

// ── Phase 2: bounded-parallel reads must stay deterministic across many files ─────
test('parallel reads: many files across projects → deterministic + correct totals', () => {
  const home = tmpDir();
  let expected = 0;
  for (let p = 0; p < 4; p++) {
    for (let s = 0; s < 6; s++) {           // 24 files total — exercises the pool + reassembly
      const out = p * 100 + s + 1;
      expected += out;
      writeFile(home, `.claude/projects/proj${p}/sess${s}.jsonl`,
        rec({ requestId: `r${p}-${s}`, output: out, ts: isoNow() }) + '\n');
    }
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const runs = Array.from({ length: 3 }, () =>
    execFileSync('node', [BIN, 'agents', '--json'], { encoding: 'utf8', env }));
  assert.equal(runs[0], runs[1]);            // identical across repeated concurrent runs
  assert.equal(runs[1], runs[2]);
  const parsed = JSON.parse(runs[0]);
  assert.equal(parsed.length, 24);
  assert.equal(parsed.reduce((s, a) => s + a.output, 0), expected);  // nothing lost/double-counted
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

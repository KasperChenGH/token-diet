'use strict';
// Smoke tests for the human-readable report commands (diagnose / audit / plan / compare).
//
// These commands are read-only text formatters over already-tested core (scan, estimate,
// review). The risk they carry is "throws on a real transcript" — a regression CI wouldn't
// otherwise catch, because the existing CLI tests only exercise their `--json` branch.
// Each test below drives the DEFAULT (text) render path end-to-end and asserts the command
// exits 0 and emits its top-level section header. Correctness of the numbers lives in the
// per-module unit tests; this is the "does the report render at all" backstop.
const { test }        = require('node:test');
const assert          = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path            = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');

// One assistant usage record (the shape scan reads). Unique requestId → never deduped.
function usageRecord(reqId, isoTs, model = 'claude-opus-4') {
  return JSON.stringify({
    type: 'assistant', requestId: reqId, timestamp: isoTs, sessionId: 's1',
    message: { model, usage: {
      input_tokens: 10, cache_creation_input_tokens: 100,
      cache_read_input_tokens: 500, output_tokens: 50 } },
  });
}

const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();

// Run the CLI in text mode; returns stdout. Throws (fails the test) on a non-zero exit.
function runText(args, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return execFileSync('node', [BIN, ...args], { encoding: 'utf8', env });
}

test('diagnose renders the text report on a fixture transcript (exit 0)', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    usageRecord('d1', daysAgo(1)) + '\n' + usageRecord('d2', daysAgo(2)) + '\n');
  const out = runText(['diagnose', '--days', '7'], home);
  assert.match(out, /=== Token Diagnose ===/);
  assert.match(out, /\[Lever 5\] HOT FILES/);   // a section header always printed
  rm(home);
});

test('audit renders the text report on a fixture transcript (exit 0)', () => {
  const home = tmpDir();
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    usageRecord('a1', daysAgo(1)) + '\n' + usageRecord('a2', daysAgo(3)) + '\n');
  const out = runText(['audit', '--days', '7'], home);
  assert.match(out, /=== Token Audit ===/);
  assert.match(out, /Top 10 sessions/);
  rm(home);
});

test('plan renders the full text report + writes the plan file (exit 0)', () => {
  const dir  = tmpDir();
  const home = tmpDir();
  // History present → the full report renders (the path the --json/no-history tests skip).
  writeFile(home, '.claude/projects/proj/sess.jsonl',
    usageRecord('p1', daysAgo(1)) + '\n' + usageRecord('p2', daysAgo(2)) + '\n');
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
  const out = runText(['plan', '--dir', dir, '--days', '7'], home);
  assert.match(out, /Changeset skeleton:/);
  assert.match(out, /Plan written to:/);
  // The plan markdown actually landed on disk.
  assert.ok(require('fs').existsSync(path.join(dir, 'diet-plan.md')));
  rm(dir); rm(home);
});

test('compare renders the before/after report across two windows (exit 0)', () => {
  const home = tmpDir();
  // before window (14d→7d ago): records ~10d old. after window (last 7d): records ~2d old.
  const lines = [
    usageRecord('b1', daysAgo(10)), usageRecord('b2', daysAgo(9)),
    usageRecord('f1', daysAgo(2)),  usageRecord('f2', daysAgo(1)),
  ].join('\n') + '\n';
  writeFile(home, '.claude/projects/proj/sess.jsonl', lines);
  const out = runText(['compare', '--before-days', '14', '--after-days', '7'], home);
  assert.match(out, /=== Token Compare: Before vs After ===/);
  assert.match(out, /Verdict:/);
  rm(home);
});

test('review renders the static text report (scorecard + grade) on a fixture (exit 0)', () => {
  const dir  = tmpDir();
  const home = tmpDir();
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')); // trips Lever 6
  const env  = { ...process.env, HOME: home, USERPROFILE: home };
  const out  = execFileSync('node', [BIN, 'review', '--dir', dir], { encoding: 'utf8', env });
  assert.match(out, /=== token-diet review \(STATIC\) ===/);
  assert.match(out, /Scorecard \(project-scope findings only\)/);
  assert.match(out, /Overall Grade:/);
  assert.match(out, /\[Lever 6\]/);             // the finding rendered
  rm(dir); rm(home);
});

test('review --json emits grade + an 8-lever scorecard + overhead block (exit 0)', () => {
  const dir  = tmpDir();
  const home = tmpDir();
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
  const env  = { ...process.env, HOME: home, USERPROFILE: home };
  const j = JSON.parse(execFileSync('node', [BIN, 'review', '--dir', dir, '--json'], { encoding: 'utf8', env }));
  assert.match(j.grade, /^[A-F]$/);
  assert.equal(Object.keys(j.scorecard).length, 8);
  assert.ok(j.overhead && typeof j.overhead.per_spawn_tokens === 'number');
  rm(dir); rm(home);
});

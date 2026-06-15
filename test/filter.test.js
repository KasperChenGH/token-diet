'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const F = require('../src/filter');

// Isolate global ~/.claude so loadConfig() can't read a real install during tests.
const HOME = tmpDir();
process.env.HOME = HOME; process.env.USERPROFILE = HOME;

const silence = fn => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

test('compressTests keeps failures + traceback + summary, collapses passing', () => {
  const input = 'a PASSED\n'.repeat(10) + 'b FAILED\n  assert x\n10 passed, 1 failed';
  const out = F.compressTests(input, F.DEFAULT_CONFIG);
  assert.match(out, /FAILED/);
  assert.match(out, /assert x/);            // indented continuation kept
  assert.match(out, /1 failed/);
  assert.match(out, /passing\/ok lines/);   // passing collapsed
  assert.ok(out.split('\n').length < input.split('\n').length);
});

test('compressTests collapses per-test lines whose names contain digits (regression)', () => {
  const input = Array.from({ length: 50 }, (_, i) => `test_mod.py::test_${i} PASSED`).join('\n')
    + '\n=== 1 failed, 49 passed in 0.2s ===\ntest_mod.py::test_7 FAILED\n  assert False';
  const out = F.compressTests(input, F.DEFAULT_CONFIG);
  assert.match(out, /passing\/ok lines/);    // per-test PASSED lines collapsed
  assert.match(out, /1 failed, 49 passed/);  // aggregate summary kept
  assert.match(out, /test_7 FAILED/);        // failure kept
  assert.ok(out.split('\n').length < 10, `expected heavy compression, got ${out.split('\n').length} lines`);
});

test('compressGit status keeps branch + changed files', () => {
  const input = 'On branch main\nChanges not staged:\n\tmodified:   a.js\n\tmodified:   b.js\nuse git add';
  const out = F.compressGit(input, 'git status', F.DEFAULT_CONFIG);
  assert.match(out, /On branch main/);
  assert.match(out, /modified:\s+a\.js/);
});

test('compressRead head/tail-elides a large file', () => {
  const input = Array.from({ length: 100 }, (_, i) => `L${i}`).join('\n');
  const out = F.compressRead(input, { ...F.DEFAULT_CONFIG, headTail: 10 });
  assert.match(out, /L0/); assert.match(out, /L99/);
  assert.match(out, /lines elided/);
  assert.ok(out.split('\n').length < 100);
});

test('dedupLog collapses repeated lines', () => {
  const out = F.dedupLog('x\n'.repeat(30) + 'y', F.DEFAULT_CONFIG);
  assert.match(out, /x\s+\(×30\)/);
});

test('classify routes a test command to the tests compressor', () => {
  const fn = F.classify({ tool_name: 'Bash', tool_input: { command: 'pytest -q' } }, F.DEFAULT_CONFIG);
  assert.match(fn('ok\n'.repeat(5) + 'FAILED\nx'), /FAILED/);
});

test('extractOutput handles string, stdout-object, and unknown shapes', () => {
  assert.equal(F.extractOutput({ tool_response: 'hi' }), 'hi');
  assert.equal(F.extractOutput({ tool_response: { stdout: 'a', stderr: 'b' } }), 'a\nb');
  assert.equal(F.extractOutput({ tool_response: { weird: 1 } }), null);
  assert.equal(F.extractOutput({}), null);
});

test('compressPayload: disabled gate → null; enabled + large → rewrite + full sidecar', () => {
  const root = tmpDir();
  const big = Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\n');
  const payload = { tool_name: 'Bash', tool_input: { command: 'echo' }, tool_response: big };

  assert.equal(F.compressPayload(payload, root, 'ts'), null);          // no config → disabled

  fs.mkdirSync(path.join(root, '.claude', 'toolout'), { recursive: true });
  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: true, mode: 'active' }));
  const out = F.compressPayload(payload, root, '2026-01-01T00:00:00.000Z');
  assert.ok(out, 'expected a rewrite');
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(j.hookSpecificOutput.updatedToolOutput, /full: \.claude\/toolout\//);

  const logs = fs.readdirSync(path.join(root, '.claude', 'toolout')).filter(f => f.endsWith('.log'));
  assert.equal(logs.length, 1);
  assert.match(fs.readFileSync(path.join(root, '.claude', 'toolout', logs[0]), 'utf8'), /row 199/);
  rm(root);
});

test('compressPayload: small output passes through (null)', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude', 'toolout'), { recursive: true });
  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: true }));
  assert.equal(F.compressPayload({ tool_name: 'Bash', tool_input: { command: 'echo' }, tool_response: 'tiny' }, root, 'ts'), null);
  rm(root);
});

test('runFilter is fail-safe on malformed stdin (no throw, no output)', () => {
  let wrote = '';
  const orig = process.stdout.write; process.stdout.write = s => { wrote += s; return true; };
  try { F.runFilter({ _stdin: 'not json', dir: tmpDir() }); } finally { process.stdout.write = orig; }
  assert.equal(wrote, '');
});

test('install writes disabled config + settings hook; setEnabled flips the gate', () => {
  const root = tmpDir();
  silence(() => F.runInstall({ dir: root }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'toolout', 'filter.json'), 'utf8')).enabled, false);
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(set.hooks.PostToolUse.some(h => h.hooks.some(x => x.command === 'token-diet filter')));
  silence(() => F.setEnabled({ dir: root }, true));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'toolout', 'filter.json'), 'utf8')).enabled, true);
  rm(root);
});

test('aggregateStats: rolls up by kind with reduction % and a total (golden)', () => {
  const { rows, total } = F.aggregateStats([
    { kind: 'tests', rawTok: 1000, compTok: 100 },
    { kind: 'tests', rawTok: 1000, compTok: 300 },
    { kind: 'git',   rawTok: 200,  compTok: 50  },
  ]);
  const tests = rows.find(r => r.kind === 'tests');
  assert.equal(tests.count, 2);
  assert.equal(tests.raw, 2000);
  assert.equal(tests.comp, 400);
  assert.equal(tests.pct, 80);              // (2000-400)/2000
  assert.equal(rows[0].kind, 'tests');      // sorted by absolute saving (1600 > 150)
  assert.equal(total.count, 3);
  assert.equal(total.raw, 2200);
  assert.equal(total.pct, 80);              // (2200-450)/2200 ≈ 79.5 → 80
});

test('compressPayload records one stats line per compressed call', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude', 'toolout'), { recursive: true });
  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: true }));
  const big = Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\n');
  F.compressPayload({ tool_name: 'Bash', tool_input: { command: 'pytest -q' }, tool_response: big }, root, 'ts');
  const stats = fs.readFileSync(path.join(root, '.claude', 'toolout', 'stats.jsonl'), 'utf8').trim().split('\n');
  assert.equal(stats.length, 1);
  const e = JSON.parse(stats[0]);
  assert.equal(e.kind, 'tests');
  assert.ok(e.rawTok > e.compTok, 'raw should exceed compressed');
  rm(root);
});

test('runReport with no stats prints guidance and does not throw', () => {
  const root = tmpDir();
  let out = ''; const o = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { F.runReport({ dir: root }); } finally { console.log = o; }
  assert.match(out, /No filter activity/);
  rm(root);
});

test('audit mode records the would-be saving but leaves output untouched', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude', 'toolout'), { recursive: true });
  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: true, mode: 'audit' }));
  const big = Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\n');
  const payload = { tool_name: 'Bash', tool_input: { command: 'echo' }, tool_response: big };
  assert.equal(F.compressPayload(payload, root, 'ts'), null, 'audit must not rewrite output');
  const stats = fs.readFileSync(path.join(root, '.claude', 'toolout', 'stats.jsonl'), 'utf8').trim().split('\n');
  assert.equal(stats.length, 1, 'audit still records what it would have saved');
});

test('keep-patterns protect a matching line from being collapsed', () => {
  const cfg = { ...F.DEFAULT_CONFIG, keep: ['DEPRECATION'] };
  const input = 'a PASSED\n'.repeat(20) + 'DEPRECATION: old api used\n' + 'b PASSED\n'.repeat(20);
  assert.match(F.compressTests(input, cfg), /DEPRECATION: old api used/);  // kept despite not being a failure
  assert.doesNotMatch(F.compressTests(input, { ...F.DEFAULT_CONFIG }), /DEPRECATION/);  // collapsed without the keep rule
});

test('tools allowlist: Read passes through by default; compresses only when opted in', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude', 'toolout'), { recursive: true });
  const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  const readPayload = { tool_name: 'Read', tool_input: { file_path: 'big.py' }, tool_response: big };

  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: true }));   // default tools=['Bash']
  assert.equal(F.compressPayload(readPayload, root, 'ts'), null, 'Read should pass through by default');

  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: true, mode: 'active', tools: ['Bash', 'Read'] }));
  assert.ok(F.compressPayload(readPayload, root, 'ts2'), 'Read should compress once opted in');
  rm(root);
});

test('keep-patterns survive log-dedup head/tail elision', () => {
  const cfg = { ...F.DEFAULT_CONFIG, headTail: 5, keep: ['KEEPME'] };
  const input = Array.from({ length: 30 }, (_, i) => `noise ${i}`).join('\n').replace('noise 15', 'KEEPME critical line');
  assert.match(F.dedupLog(input, cfg), /KEEPME critical line/);   // protected even though it's in the elided middle
});

test('install preserves OTHER PostToolUse hooks and stays idempotent', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFile(root, '.claude/settings.json', JSON.stringify({ hooks: { PostToolUse: [
    { matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier' }] } ] } }));
  silence(() => F.runInstall({ dir: root }));
  silence(() => F.runInstall({ dir: root }));   // twice → idempotent
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(set.hooks.PostToolUse.some(h => h.hooks.some(x => x.command === 'prettier')), 'foreign hook preserved');
  assert.equal(set.hooks.PostToolUse.filter(h => h.hooks.some(x => x.command === 'token-diet filter')).length, 1, 'exactly one token-diet entry');
  rm(root);
});

test('install matcher follows filter.json tools', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude', 'toolout'), { recursive: true });
  writeFile(root, '.claude/toolout/filter.json', JSON.stringify({ enabled: false, tools: ['Bash', 'Read'] }));
  silence(() => F.runInstall({ dir: root }));
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const entry = set.hooks.PostToolUse.find(h => h.hooks.some(x => x.command === 'token-diet filter'));
  assert.equal(entry.matcher, 'Bash|Read');
  rm(root);
});

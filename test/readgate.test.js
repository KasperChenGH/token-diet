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

// ── Task 2: hook entrypoint + benchmark ────────────────────────────────────────
test('runHook: active deny writes JSON to stdout; allow writes nothing', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  const fp = path.join(root, 'big.txt');
  const capture = (payload) => {
    let wrote = ''; const orig = process.stdout.write; process.stdout.write = s => { wrote += s; return true; };
    try { R.runHook({ _stdin: JSON.stringify(payload), dir: root, _nowIso: T1 }); }
    finally { process.stdout.write = orig; }
    return wrote;
  };
  // seed a first read (allow, nothing written)
  assert.equal(capture({ session_id: 's1', tool_name: 'Read', cwd: root, tool_input: { file_path: fp } }), '');
  // redundant re-read → deny JSON on stdout
  const out = capture({ session_id: 's1', tool_name: 'Read', cwd: root, tool_input: { file_path: fp } });
  assert.match(out, /"permissionDecision":"deny"/);
  rm(root);
});

test('runHook: malformed stdin is fail-safe (no throw, no output)', () => {
  let wrote = ''; const orig = process.stdout.write; process.stdout.write = s => { wrote += s; return true; };
  try { R.runHook({ _stdin: 'not json', dir: tmpDir() }); } finally { process.stdout.write = orig; }
  assert.equal(wrote, '');
});

// CANONICAL BENCHMARK — the ONLY source of any published savings number for readgate.
// Sequence: read A(2000B≈500tok), read B, re-read A unchanged (redundant), modify A, re-read A (allowed).
// Expected measured outcome: exactly 1 redundant read detected, 500 avoided tokens.
test('benchmark: replay sequence yields exactly one 500-tok redundant detection', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'audit' });
  writeFile(root, 'A.txt', 'x'.repeat(2000));
  writeFile(root, 'B.txt', 'y'.repeat(2000));
  const rd = (rel) => readOf(root, rel);
  R.decide(rd('A.txt'), root, T0);            // 1. read A
  R.decide(rd('B.txt'), root, T0);            // 2. read B
  R.decide(rd('A.txt'), root, T1);            // 3. re-read A unchanged → REDUNDANT (recorded)
  writeFile(root, 'A.txt', 'z'.repeat(2400)); // 4. modify A
  R.decide(rd('A.txt'), root, T1);            // 5. re-read A changed → allowed (not recorded)
  const stats = fs.readFileSync(path.join(root, '.claude', 'readgate', 'stats.jsonl'), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l));
  assert.equal(stats.length, 1, 'exactly one redundant read across the sequence');
  assert.equal(stats[0].tok, 500, 'avoided tokens == estTok(2000)');
  const totalAvoided = stats.reduce((s, e) => s + e.tok, 0);
  assert.equal(totalAvoided, 500);           // the published, reproducible number
  rm(root);
});

// ── Task 3: install / uninstall / setState / self-test ─────────────────────────
const silence = fn => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

test('install writes disabled config + a PreToolUse Read hook; setState flips the gate', () => {
  const root = tmpDir();
  silence(() => R.runInstall({ dir: root }));
  const conf = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'readgate', 'config.json'), 'utf8'));
  assert.equal(conf.enabled, false);
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const entry = set.hooks.PreToolUse.find(h => h.hooks.some(x => x.command === 'token-diet readgate'));
  assert.equal(entry.matcher, 'Read');
  silence(() => R.setState({ dir: root }, true, 'active'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'readgate', 'config.json'), 'utf8')).mode, 'active');
  rm(root);
});

test('install preserves OTHER PreToolUse hooks and is idempotent', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFile(root, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] } ] } }));
  silence(() => R.runInstall({ dir: root }));
  silence(() => R.runInstall({ dir: root }));   // twice → idempotent
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(set.hooks.PreToolUse.some(h => h.hooks.some(x => x.command === 'guard')), 'foreign hook preserved');
  assert.equal(set.hooks.PreToolUse.filter(h => h.hooks.some(x => x.command === 'token-diet readgate')).length, 1);
  rm(root);
});

test('install refuses to overwrite a present-but-corrupt settings.json', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFile(root, '.claude/settings.json', '{ not json');
  assert.throws(() => silence(() => R.runInstall({ dir: root })), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'), '{ not json');
  rm(root);
});

test('uninstall removes the readgate hook and leaves no empty husks', () => {
  const root = tmpDir();
  silence(() => R.runInstall({ dir: root }));
  silence(() => R.runUninstall({ dir: root }));
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(!set.hooks || !set.hooks.PreToolUse, 'no empty PreToolUse array left behind');
  rm(root);
});

test('runSelfTest prints detection and does not throw', () => {
  let out = ''; const o = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { R.runSelfTest(); } finally { console.log = o; }
  assert.match(out, /readgate/i);
});

// ── Task 4: measured --report ──────────────────────────────────────────────────
test('aggregateStats rolls up by file with a total (golden)', () => {
  const { rows, total } = R.aggregateStats([
    { file: '/a.txt', tok: 500, mode: 'audit' },
    { file: '/a.txt', tok: 500, mode: 'audit' },
    { file: '/b.txt', tok: 800, mode: 'audit' },
  ]);
  const a = rows.find(r => r.file === '/a.txt');
  assert.equal(a.count, 2);
  assert.equal(a.tok, 1000);
  assert.equal(rows[0].file, '/a.txt');   // sorted by tok desc (1000 > 800)
  assert.equal(total.count, 3);
  assert.equal(total.tok, 1800);
});

test('runReport with no stats prints guidance and does not throw', () => {
  const root = tmpDir();
  let out = ''; const o = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { R.runReport({ dir: root }); } finally { console.log = o; }
  assert.match(out, /No readgate activity/);
  rm(root);
});

test('runReport --json emits the aggregate', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude', 'readgate'), { recursive: true });
  writeFile(root, '.claude/readgate/stats.jsonl',
    JSON.stringify({ file: '/a.txt', tok: 500, mode: 'audit' }) + '\n');
  let out = ''; const o = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { R.runReport({ dir: root, json: true }); } finally { console.log = o; }
  const j = JSON.parse(out);
  assert.equal(j.total.tok, 500);
  rm(root);
});

// ── Task 5: CLI dispatch (runs the real binary) ────────────────────────────────
const { execFileSync } = require('node:child_process');
const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');

test('CLI: `readgate --install` registers the hook end-to-end', () => {
  const root = tmpDir();
  execFileSync(process.execPath, [BIN, 'readgate', '--install', '--dir', root],
    { env: { ...process.env, HOME, USERPROFILE: HOME }, stdio: 'ignore' });
  const set = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(set.hooks.PreToolUse.some(h => h.hooks.some(x => x.command === 'token-diet readgate')));
  rm(root);
});

test('CLI: `readgate` (no flag) hook mode denies a redundant read via stdin', () => {
  const root = tmpDir(); cfg(root, { enabled: true, mode: 'active' });
  writeFile(root, 'big.txt', 'x'.repeat(2000));
  const fp = path.join(root, 'big.txt');
  const payload = JSON.stringify({ session_id: 's1', tool_name: 'Read', cwd: root, tool_input: { file_path: fp } });
  const run = () => execFileSync(process.execPath, [BIN, 'readgate'],
    { input: payload, env: { ...process.env, HOME, USERPROFILE: HOME } }).toString();
  assert.equal(run().trim(), '');                       // first read allowed
  assert.match(run(), /"permissionDecision":"deny"/);   // redundant read denied
  rm(root);
});

'use strict';
/**
 * readgate.js — Lever 3 (evict redundant compute), read path. PreToolUse hook handler.
 *
 * Detects when the agent re-reads the SAME file+range, UNCHANGED, within one session and
 * (in active mode) denies the redundant read with a recoverable reason. Audit mode records
 * what it would save and changes nothing. Disabled by default (gate in
 * .claude/readgate/config.json). Any error / unknown shape → allow (read proceeds). Zero-dep.
 *
 * The read-path twin of src/filter.js (Lever 8 output filter). Same lifecycle + safety model.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { writeFileAtomic } = require('./atomic');

const estTok = bytes => Math.round((bytes || 0) / 4);

const DEFAULT_CONFIG = {
  // enabled: master gate. mode: 'audit' = record what it'd save, deny nothing; 'active' = deny redundant reads.
  // tools: which tools to gate (Read only for v1). minTokens: skip reads smaller than this (not worth friction).
  // ttlMinutes: only treat a prior read as still-in-context within this window (conservative vs compaction).
  enabled: false, mode: 'audit', tools: ['Read'], minTokens: 400, ttlMinutes: 120,
};

// Global then project config (project wins) — honors a --global install whose hook runs in the project cwd.
function loadConfig(root) {
  let cfg = { ...DEFAULT_CONFIG };
  for (const base of [path.join(os.homedir(), '.claude'), path.join(root, '.claude')]) {
    try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(base, 'readgate', 'config.json'), 'utf8')) }; }
    catch { /* absent — keep prior */ }
  }
  return cfg;
}

const rangeKey = ti => `${ti.file_path}|${ti.offset ?? ''}|${ti.limit ?? ''}`;
const isUnchanged = (prev, stat) => prev.mtimeMs === stat.mtimeMs && prev.size === stat.size;
function withinTtl(prevTs, nowIso, ttlMinutes) {
  const a = Date.parse(prevTs), b = Date.parse(nowIso);
  if (isNaN(a) || isNaN(b)) return false;
  return (b - a) <= ttlMinutes * 60000;
}

function statePath(root, sid) {
  return path.join(root, '.claude', 'readgate', 'seen', `${String(sid || 'nosession').replace(/[^\w.-]/g, '_')}.json`);
}
function loadState(root, sid) {
  try { return JSON.parse(fs.readFileSync(statePath(root, sid), 'utf8')); } catch { return {}; }
}
function saveState(root, sid, state) {
  const p = statePath(root, sid);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeFileAtomic(p, JSON.stringify(state));
}

function recordStats(root, entry) {
  try {
    const dir = path.join(root, '.claude', 'readgate');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'stats.jsonl'), JSON.stringify(entry) + '\n');
  } catch { /* best-effort — never break the hook */ }
}

function denyJson(file, ti, tok) {
  const range = (ti.offset != null || ti.limit != null) ? ` [offset ${ti.offset ?? 0}, limit ${ti.limit ?? '∞'}]` : '';
  const reason = `token-diet readgate: ${file}${range} is already in context from an earlier read this `
    + `session (unchanged, ~${tok} tok). If it was evicted by compaction, re-read a different range to bypass.`;
  return JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

// Core: decide whether to allow (null) or deny (JSON string). Pure w.r.t. nowIso for deterministic tests.
function decide(payload, root, nowIso) {
  try {
    const cfg = loadConfig(root);
    if (!cfg.enabled) return null;
    const tool = payload && payload.tool_name;
    const tools = Array.isArray(cfg.tools) && cfg.tools.length ? cfg.tools : ['Read'];
    if (!tools.includes(tool)) return null;
    const ti = payload.tool_input;
    if (!ti || !ti.file_path) return null;
    let st;
    try { st = fs.statSync(ti.file_path); } catch { return null; }   // missing file → let Read surface its own error
    const stat = { mtimeMs: st.mtimeMs, size: st.size };
    const tok = estTok(stat.size);
    if (tok < cfg.minTokens) return null;                            // not worth gating; do not record

    const sid = payload.session_id;
    const state = loadState(root, sid);
    const key = rangeKey(ti);
    const prev = state[key];

    if (prev && isUnchanged(prev, stat) && withinTtl(prev.ts, nowIso, cfg.ttlMinutes)) {
      recordStats(root, { ts: nowIso, file: ti.file_path, tok, mode: cfg.mode || 'audit' });
      if ((cfg.mode || 'audit') !== 'active') return null;           // audit → record only, allow
      return denyJson(ti.file_path, ti, tok);                        // active → deny redundant read
    }
    // new / changed / stale → (re)record and allow
    state[key] = { mtimeMs: stat.mtimeMs, size: stat.size, ts: nowIso, tok };
    saveState(root, sid, state);
    return null;
  } catch { return null; }                                           // fail-open
}

// ── install / enable / uninstall / self-test ──────────────────────────────────
function resolveBase(opts) {
  const root = opts.global ? os.homedir() : (opts.dir ? path.resolve(opts.dir) : process.cwd());
  return path.join(root, '.claude');
}
const HOOK_CMD = 'token-diet readgate';
const MATCHER  = 'Read';

function runInstall(opts = {}) {
  const base = resolveBase(opts);
  fs.mkdirSync(path.join(base, 'readgate'), { recursive: true });
  const cfgP = path.join(base, 'readgate', 'config.json');
  if (!fs.existsSync(cfgP)) writeFileAtomic(cfgP, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');

  const setP = path.join(base, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(setP, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw new Error(`${setP} exists but is not valid JSON — refusing to overwrite it. Fix or remove it, then re-run.`);
  }
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  settings.hooks.PreToolUse = settings.hooks.PreToolUse
    .map(h => ({ ...h, hooks: (h.hooks || []).filter(x => x.command !== HOOK_CMD) }))
    .filter(h => (h.hooks || []).length > 0);
  settings.hooks.PreToolUse.push({ matcher: MATCHER, hooks: [{ type: 'command', command: HOOK_CMD }] });
  writeFileAtomic(setP, JSON.stringify(settings, null, 2) + '\n');

  console.log(`\ntoken-diet readgate installed (DISABLED) at ${base}`);
  console.log(`  hook   : PreToolUse [${MATCHER}] → ${HOOK_CMD}`);
  console.log(`  config : ${cfgP}`);
  console.log(`\nNext: --self-test → --enable (AUDIT: records what it'd save, denies nothing) → --report → --activate`);
  console.log(`Tune in config.json: "minTokens", "ttlMinutes".\n`);
}

function runUninstall(opts = {}) {
  const setP = path.join(resolveBase(opts), 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(setP, 'utf8'));
    if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
      settings.hooks.PreToolUse = settings.hooks.PreToolUse
        .map(h => ({ ...h, hooks: (h.hooks || []).filter(x => x.command !== HOOK_CMD) }))
        .filter(h => (h.hooks || []).length > 0);
      if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      writeFileAtomic(setP, JSON.stringify(settings, null, 2) + '\n');
    }
    console.log(`token-diet readgate hook removed from ${setP}`);
  } catch { console.log('No settings.json hook to remove.'); }
}

function setState(opts, enabled, mode) {
  const cfgP = path.join(resolveBase(opts), 'readgate', 'config.json');
  let cfg = { ...DEFAULT_CONFIG };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgP, 'utf8')) }; } catch { /* default */ }
  cfg.enabled = enabled;
  if (mode) cfg.mode = mode;
  fs.mkdirSync(path.dirname(cfgP), { recursive: true });
  writeFileAtomic(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  const state = !enabled ? 'disabled'
    : cfg.mode === 'active' ? 'ACTIVE — denying redundant re-reads'
    : 'AUDIT — recording redundant reads; nothing denied. Review with --report, then --activate';
  console.log(`\ntoken-diet readgate: ${state}\n  ${cfgP}\n`);
}
function setEnabled(opts, enabled) { return setState(opts, enabled, enabled ? 'audit' : undefined); }

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-selftest-'));
  try {
    fs.mkdirSync(path.join(root, '.claude', 'readgate'), { recursive: true });
    writeFileAtomic(path.join(root, '.claude', 'readgate', 'config.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, enabled: true, mode: 'active' }));
    const fp = path.join(root, 'sample.txt');
    fs.writeFileSync(fp, 'x'.repeat(2000));
    const mk = () => ({ session_id: 'selftest', tool_name: 'Read', cwd: root, tool_input: { file_path: fp } });
    const nowIso = new Date().toISOString();
    const first = decide(mk(), root, nowIso);
    const second = decide(mk(), root, nowIso);
    console.log('\n=== token-diet readgate --self-test (fixture) ===\n');
    console.log(`▶ first read of a 2000-byte file : ${first === null ? 'ALLOWED' : 'denied'} (expected ALLOWED)`);
    console.log(`▶ identical unchanged re-read    : ${second ? 'DENIED' : 'allowed'} (expected DENIED in active mode)`);
    if (second) console.log('    reason: ' + JSON.parse(second).hookSpecificOutput.permissionDecisionReason);
    console.log('\nFixture only. Enable on real sessions with: token-diet readgate --enable\n');
  } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } }
}

// ── hook-mode entrypoint (reads stdin, writes stdout) ──────────────────────────
function runHook(opts = {}) {
  try {
    const raw = opts._stdin != null ? opts._stdin : fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    const root = payload.cwd ? path.resolve(payload.cwd)
               : opts.dir ? path.resolve(opts.dir) : process.cwd();
    const nowIso = opts._nowIso || new Date().toISOString();
    const out = decide(payload, root, nowIso);
    if (out) process.stdout.write(out);
  } catch { /* fail-safe: emit nothing → read proceeds */ }
}

module.exports = {
  DEFAULT_CONFIG, loadConfig, estTok, rangeKey, isUnchanged, withinTtl,
  statePath, loadState, saveState, recordStats, denyJson, decide, runHook,
  runInstall, runUninstall, setState, setEnabled, runSelfTest,
};

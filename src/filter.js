'use strict';
/**
 * filter.js — Lever 8 output-compression engine + PostToolUse hook handler.
 *
 * Hook mode: reads a Claude Code PostToolUse payload on stdin, writes the FULL tool
 * output to a sidecar log, and emits `updatedToolOutput` with a compressed view + a
 * pointer to the sidecar. Disabled by default (gate in .claude/toolout/filter.json);
 * any error or unrecognized shape → no rewrite (original output preserved). Zero-dep.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { writeFileAtomic } = require('./atomic');

const estTok = s => Math.round((s || '').length / 4);

const DEFAULT_CONFIG = {
  // Shells (Bash + PowerShell) by default: compress incidental verbose command output, NOT
  // intentional retrieval (Read/Grep → Lever 5 digests) or semantic tool results (Task/Edit).
  // Opt in to more by adding them to `tools`.
  // mode: 'audit' = record what it would save but leave output untouched; 'active' = compress.
  // keep: regex patterns whose matching lines are NEVER collapsed (protect your own signals).
  enabled: false, mode: 'audit', tools: ['Bash', 'PowerShell'], keep: [],
  minTokensToCompress: 1500, minLines: 60, headTail: 20, sidecarRetentionDays: 7,
};

// Build a "never collapse this line" predicate from cfg.keep (case-insensitive regexes).
// ReDoS guard: `keep` is user-supplied and runs synchronously in the PostToolUse hot path,
// so reject non-strings + over-long patterns, and skip pathologically long lines — a
// catastrophic-backtracking pattern must never be able to stall the Claude Code session.
const KEEP_MAX_PATTERN = 200;   // chars
const KEEP_MAX_LINE    = 10000; // chars — don't run user regex on a line longer than this
function keepMatcher(cfg) {
  const res = ((cfg && cfg.keep) || [])
    .filter(p => typeof p === 'string' && p.length <= KEEP_MAX_PATTERN)
    .map(p => { try { return new RegExp(p, 'i'); } catch { return null; } }).filter(Boolean);
  if (!res.length) return () => false;
  return ln => ln.length <= KEEP_MAX_LINE && res.some(re => re.test(ln));
}

function configPath(root) { return path.join(root, '.claude', 'toolout', 'filter.json'); }
// Read global then project config (project wins) so a `--global` install's gate is
// honored even though the hook runs with the user's project as its cwd.
function loadConfig(root) {
  let cfg = { ...DEFAULT_CONFIG };
  for (const base of [path.join(os.homedir(), '.claude'), path.join(root, '.claude')]) {
    try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(base, 'toolout', 'filter.json'), 'utf8')) }; }
    catch { /* absent — keep prior */ }
  }
  return cfg;
}

// ── noise stripping ───────────────────────────────────────────────────────────
function stripNoise(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')                     // CRLF → LF
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')  // ANSI/CSI escape sequences
    .replace(/[^\n]*\r/g, '');                  // lone CR = progress overwrite; keep post-CR text
}

// ── compressors (pure: string -> string) ──────────────────────────────────────
const FAIL_RE    = /(fail(ed|ure|s)?|error|assert|traceback|exception|panic|✗|✘|✖|\[-\]|\bFAILED\b|\bERROR\b|\bnot ok\b)/i;
// Summary lines only — the count digit must sit at a token boundary so per-test lines
// like "test_5 PASSED" (digit inside the name) are collapsed, not kept.
const SUMMARY_RE = /(?:^|\s)\d+\s+(?:passed|failed|errors?|skipped|deselected|tests?\b)|test result:|\bRan\s+\d+\s+test|={3,}[^=]*\b(?:passed|failed)\b|^\s*OK\b|^\s*FAILED\b/i;

function compressTests(text, cfg) {
  const protect = keepMatcher(cfg);
  const lines = stripNoise(text).split('\n');
  const kept = []; let run = 0; let lastKept = false;
  const flush = () => { if (run > 0) { kept.push(`  … (${run} passing/ok lines)`); run = 0; } };
  for (const ln of lines) {
    const keep = FAIL_RE.test(ln) || SUMMARY_RE.test(ln) || (lastKept && /^\s+\S/.test(ln)) || protect(ln);
    if (keep) { flush(); kept.push(ln); lastKept = true; }
    else { run++; lastKept = false; }
  }
  flush();
  return kept.join('\n').trim();
}

// Build/install tool output (npm/cargo/docker/tsc/eslint): keep errors, warnings,
// deprecations and the terminal summary; collapse the per-package / per-crate /
// per-layer progress that makes up the bulk. Same shape as compressTests, build vocab.
const BUILD_KEEP_RE = /(\berror\b|\berror\[|\bwarn(ing)?\b|deprecat|vulnerab|\bfail(ed|ure)?\b|panic|✖|✗|✘|\bFAILED\b|\bERROR\b|cannot |unable to|not found|no such|conflict)/i;
const BUILD_SUMMARY_RE = /(added|removed|changed|audited)\s+\d+\s+packages?|^\s*Finished\b|Compiled successfully|compiled with \d|Found \d+ error|\b\d+\s+problems?\b|Successfully (built|tagged)|writing image|naming to|\bbuilt in\b|\bdone in\b|\bready in\b|packages? in \d|^\s*Done\b/i;
// A bare file-path header (eslint/tsc group their errors under one of these — keep it
// so the errors below it don't lose their file context when the progress collapses).
const BUILD_CONTEXT_RE = /^(?:\.?[\/\\])?[\w./\\-]+\.(?:[jt]sx?|mjs|cjs|vue|svelte|py|go|rs|java|rb|php|c|cc|cpp|h|css|scss|json|ya?ml|toml)\s*$/i;

function compressBuild(text, cfg) {
  const protect = keepMatcher(cfg);
  const lines = stripNoise(text).split('\n');
  const kept = []; let run = 0; let lastKept = false;
  const flush = () => { if (run > 0) { kept.push(`  … (${run} progress lines)`); run = 0; } };
  for (const ln of lines) {
    const keep = BUILD_KEEP_RE.test(ln) || BUILD_SUMMARY_RE.test(ln) || BUILD_CONTEXT_RE.test(ln)
              || (lastKept && /^\s+\S/.test(ln)) || protect(ln);
    if (keep) { flush(); kept.push(ln); lastKept = true; }
    else { run++; lastKept = false; }
  }
  flush();
  return kept.join('\n').trim();
}

function compressGit(text, command, cfg) {
  const lines = stripNoise(text).split('\n');
  // Find the git subcommand even past leading flags/args (`git -C /path diff`, `git --no-pager log`).
  const sub = ((command || '').match(/\bgit\b[^|&;]*?\b(diff|show|status|log)\b/) || [])[1] || '';
  if (sub === 'diff' || sub === 'show') {
    const out = lines.filter(l => /^(diff |index |--- |\+\+\+ |@@ |Binary |rename |new file|deleted)/.test(l)
                               || /\bfiles?\s+changed\b/.test(l));
    return out.length ? out.join('\n') : dedupLog(lines.join('\n'), cfg);
  }
  if (sub === 'status') {
    const out = lines.filter(l => /^(On branch|Your branch|HEAD detached|\s+(modified|new file|deleted|renamed|untracked):|[ MADRCU?!]{1,2}\s\S)/.test(l));
    return out.length ? out.join('\n') : dedupLog(lines.join('\n'), cfg);
  }
  if (sub === 'log') {
    const out = lines.filter(l => /^commit [0-9a-f]{7,}|^\s{4}\S/.test(l));
    return out.length ? out.join('\n') : dedupLog(lines.join('\n'), cfg);
  }
  return dedupLog(lines.join('\n'), cfg);
}

const SIG_RE = /^(?:\s*\d+[\t→|:]\s?)?\s*(export\s+)?(async\s+)?(def|function|class|func|fn|interface|type|struct|impl|module|public|private|protected)\b/;
function compressRead(text, cfg) {
  const lines = stripNoise(text).split('\n');
  const n = cfg.headTail;
  if (lines.length <= n * 2 + 5) return lines.join('\n');
  const protect = keepMatcher(cfg);
  const head = lines.slice(0, n);
  const tail = lines.slice(-n);
  const sigs = lines.slice(n, -n).filter(l => SIG_RE.test(l) || protect(l)).slice(0, 80);
  const mid = sigs.length
    ? [`  … (${lines.length - 2 * n} lines elided — kept signatures/marked:)`, ...sigs]
    : [`  … (${lines.length - 2 * n} lines elided)`];
  return [...head, ...mid, ...tail].join('\n');
}

// Error/warning lines a generic log compressor must NEVER elide from the middle — extends
// the "never drop a failure line" contract (which tests/build have) to plain log output.
const CRITICAL_RE = /\b(error|fail(ed|ure)?|exception|traceback|panic|fatal|critical)\b|✗|✘|✖|\bwarn(ing)?\b|deprecat/i;
function dedupLog(text, cfg) {
  const lines = stripNoise(text).split('\n');
  const out = []; let prev = null, count = 0;
  const flush = () => { if (prev !== null) out.push(count > 1 ? `${prev}  (×${count})` : prev); };
  for (const ln of lines) {
    if (ln === prev) count++;
    else { flush(); prev = ln; count = 1; }
  }
  flush();
  let r = out;
  if (r.length > cfg.headTail * 2 + 10) {
    const protect = keepMatcher(cfg);
    const keep = ln => CRITICAL_RE.test(ln) || protect(ln);  // error/warning lines + user keep-patterns survive
    const head = out.slice(0, cfg.headTail);
    const tail = out.slice(-cfg.headTail);
    const mid  = out.slice(cfg.headTail, out.length - cfg.headTail);
    const kept = mid.filter(keep);
    r = [...head, ...kept, `  … (${mid.length - kept.length} lines elided)`, ...tail];
  }
  return r.join('\n');
}

// ── JSON compressor (SmartCrusher-style, deterministic, zero-dep) ──────────────
// JSON tool output (curl/API responses, `aws --output json`, `jq`, config dumps) compresses
// poorly as plain text (mostly-unique lines → low dedup). Parse it and shrink STRUCTURALLY:
// truncate long arrays (keep head+tail + a count), clip long string values, re-serialize
// compact. Signal preserved: every key is kept, and values under error/status-like keys are
// never clipped. Not JSON / parse fails → fall back to dedupLog (fail-safe).
const JSON_KEEP_KEY = /error|err|exception|fail|status|message|msg|reason|code|trace|stack|warn|detail/i;
function looksLikeJson(text) {
  const s = (text || '').trim();
  if (s.length < 200 || !(s[0] === '{' || s[0] === '[')) return false;   // cheap pre-check
  try { const v = JSON.parse(s); return v !== null && typeof v === 'object'; } catch { return false; }
}
function crushJson(node, key, o, protect) {
  if (Array.isArray(node)) {
    if (node.length > o.maxArr) {
      const head = Math.ceil(o.maxArr / 2), tail = o.maxArr - head;
      return [
        ...node.slice(0, head).map(x => crushJson(x, key, o, protect)),
        `… (${node.length - head - tail} more items)`,
        ...node.slice(node.length - tail).map(x => crushJson(x, key, o, protect)),
      ];
    }
    return node.map(x => crushJson(x, key, o, protect));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = crushJson(node[k], k, o, protect);  // keep ALL keys
    return out;
  }
  if (typeof node === 'string' && node.length > o.maxStr) {
    if (JSON_KEEP_KEY.test(key || '') || protect(node)) return node;   // never clip signal-bearing values
    return node.slice(0, o.maxStr) + `…(+${node.length - o.maxStr} chars)`;
  }
  return node;
}
function compressJson(text, cfg) {
  let data;
  try { data = JSON.parse(stripNoise(text).trim()); } catch { return dedupLog(text, cfg); }
  const protect = keepMatcher(cfg);
  const crushed = crushJson(data, '', { maxArr: 8, maxStr: 200 }, protect);
  return JSON.stringify(crushed);   // compact re-serialization (drops pretty-print whitespace too)
}

// ── classify (tool + command → compressor) ────────────────────────────────────
const TEST_CMD_RE = /\b(pytest|jest|vitest|mocha|cargo test|go test|npm (run )?test|yarn test|pnpm test|rspec|phpunit|gradle test|mvn test|unittest|Invoke-Pester)\b/;
// Build/install commands — checked AFTER tests so `npm test`/`cargo test` stay 'tests'.
const BUILD_CMD_RE = /\b(npm (ci|i|install|run build)|yarn (install|build)|pnpm (i|install|run build)|cargo (build|check|clippy)|go build|docker build|docker compose build|tsc|eslint|webpack|vite build|next build|gradle build|mvn (package|install|compile))\b/;
// git at the start OR after a separator (catches `cd x && git …`, `… | git …`, `git -C …`).
const GIT_CMD_RE = /(?:^\s*|[;&|]\s*)git\b/;
// Shells produce incidental verbose output; everything else (Read/Grep/Task/Edit/…) is
// intentional retrieval or a semantic result — left to Lever 5 / passed through.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// The compressor "kind" — also the row key in the --report table. `text` is optional: when
// given, a generic-shell output whose body parses as JSON is classified 'json' (content-based,
// since the command alone — curl/jq/aws — is too varied to detect reliably by name).
function classifyKind(payload, text) {
  const tool = payload.tool_name || '';
  const cmd  = (payload.tool_input && payload.tool_input.command) || '';
  if (tool === 'Read') return 'read';
  if (!SHELL_TOOLS.has(tool)) return text != null && looksLikeJson(text) ? 'json' : 'log';
  if (TEST_CMD_RE.test(cmd)) return 'tests';
  if (GIT_CMD_RE.test(cmd))  return 'git';
  if (BUILD_CMD_RE.test(cmd)) return 'build';
  if (text != null && looksLikeJson(text)) return 'json';
  return 'log';
}
function classify(payload, cfg) {
  const cmd = (payload.tool_input && payload.tool_input.command) || '';
  // Routing is content-aware (json detection needs the text), so decide inside the returned fn.
  return (t) => {
    switch (classifyKind(payload, t)) {
      case 'read':  return compressRead(t, cfg);
      case 'tests': return compressTests(t, cfg);
      case 'git':   return compressGit(t, cmd, cfg);
      case 'build': return compressBuild(t, cfg);
      case 'json':  return compressJson(t, cfg);
      default:      return dedupLog(t, cfg);
    }
  };
}

// ── output extraction (defensive across hook payload shapes) ───────────────────
function extractOutput(payload) {
  const tr = payload.tool_response != null ? payload.tool_response
           : payload.tool_output  != null ? payload.tool_output
           : payload.toolResponse;
  if (tr == null) return null;
  if (typeof tr === 'string') return tr;
  if (typeof tr.stdout === 'string' || typeof tr.stderr === 'string')
    return [tr.stdout || '', tr.stderr || ''].filter(Boolean).join('\n');
  for (const k of ['content', 'output', 'text', 'result']) if (typeof tr[k] === 'string') return tr[k];
  return null;
}

// ── sidecar ────────────────────────────────────────────────────────────────────
let _sidecarSeq = 0;
function writeSidecar(root, tool, full, nowIso) {
  const dir = path.join(root, '.claude', 'toolout');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = nowIso.replace(/[:.]/g, '-');
  // pid + counter suffix so two same-millisecond events for the same tool can't collide.
  const name = `${stamp}-${(tool || 'tool').replace(/[^\w-]/g, '')}-${process.pid}-${++_sidecarSeq}.log`;
  const rel = path.join('.claude', 'toolout', name);
  fs.writeFileSync(path.join(root, rel), full);
  return rel.split(path.sep).join('/');
}
// Derive a sidecar's age from the ISO stamp in its filename (survives copy/restore, unlike
// mtime); fall back to mtime if the name doesn't parse.
function sidecarAgeMs(dir, f) {
  const m = f.match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)/);
  if (m) { const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`); if (!isNaN(t)) return t; }
  try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return Date.now(); }
}
function pruneSidecar(root, days) {
  try {
    const dir = path.join(root, '.claude', 'toolout');
    // The hook spawns a fresh process per call, so rate-limit via an on-disk sentinel:
    // prune at most once/day across all invocations instead of scanning the dir every call.
    const sentinel = path.join(dir, '.last-prune');
    try { if (Date.now() - fs.statSync(sentinel).mtimeMs < 86400_000) return; } catch { /* never pruned */ }
    const cutoff = Date.now() - days * 86400_000;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.log')) continue;
      try { if (sidecarAgeMs(dir, f) < cutoff) fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
    try { fs.writeFileSync(sentinel, ''); } catch { /* best-effort */ }
  } catch { /* dir missing — nothing to prune */ }
}

// One measured line per compressed call — the raw material for `filter --report`.
function recordStats(root, entry) {
  try {
    const dir = path.join(root, '.claude', 'toolout');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'stats.jsonl'), JSON.stringify(entry) + '\n');
  } catch { /* stats are best-effort — must never break the hook */ }
}

// ── core: compress a payload → hook JSON string or null (no rewrite) ────────────
function compressPayload(payload, root, nowIso) {
  const cfg = loadConfig(root);
  if (!cfg.enabled) return null;                 // gate: disabled → pass through
  const tools = Array.isArray(cfg.tools) && cfg.tools.length ? cfg.tools : ['Bash'];
  if (!tools.includes(payload.tool_name || '')) return null;  // tool not in allowlist → pass through
  const full = extractOutput(payload);
  if (full == null) return null;                 // unknown shape → pass through
  // Measure everything on the noise-stripped text so the baseline, the "real gain" check,
  // and the recorded savings all compare like-for-like — raw CRLF/ANSI bytes must not
  // inflate `rawTok` and over-state the reduction shown in `--report`.
  const stripped  = stripNoise(full);
  const baseLines = stripped.split('\n').length;
  // Skip only when the output is small on BOTH axes (few tokens AND few lines); compress
  // when it's large on either — a token-dense blob or a line-heavy log both qualify.
  if (estTok(stripped) < cfg.minTokensToCompress && baseLines < cfg.minLines) return null;
  const compressed = classify(payload, cfg)(full).trim();
  const compLines = compressed.split('\n').length;
  // No-gain guard is TOKEN-based (not line-based): JSON compresses to one compact line, so a
  // line-count check would wrongly reject a big token saving. Tokens are what we're cutting.
  if (!compressed || estTok(compressed) >= estTok(stripped)) return null;
  const stat = { ts: nowIso, tool: payload.tool_name || '', kind: classifyKind(payload, full),
                 rawTok: estTok(stripped), compTok: estTok(compressed) };
  if ((cfg.mode || 'audit') !== 'active') { recordStats(root, stat); return null; } // audit → record, no rewrite
  // Active mode: persist the full output FIRST. If the sidecar write throws (disk full, etc.)
  // the outer fail-safe preserves the original output AND no misleading stat is recorded.
  pruneSidecar(root, cfg.sidecarRetentionDays);
  const sidecar = writeSidecar(root, payload.tool_name, full, nowIso);
  recordStats(root, stat);
  const view = `${compressed}\n[token-diet: compressed ${baseLines}→${compLines} lines · full: ${sidecar}]`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: view } });
}

// ── hook-mode entrypoint (reads stdin, writes stdout) ──────────────────────────
function runFilter(opts = {}) {
  try {
    const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
    const raw  = opts._stdin != null ? opts._stdin : fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    const nowIso = opts._nowIso || new Date().toISOString();
    const out = compressPayload(payload, root, nowIso);
    if (out) process.stdout.write(out);
  } catch { /* fail-safe: emit nothing → original output preserved */ }
}

// ── install / enable / uninstall / self-test ──────────────────────────────────
function resolveBase(opts) {
  const root = opts.global ? os.homedir() : (opts.dir ? path.resolve(opts.dir) : process.cwd());
  return path.join(root, '.claude');
}
const HOOK_CMD = 'token-diet filter';

function runInstall(opts = {}) {
  const base = resolveBase(opts);
  fs.mkdirSync(path.join(base, 'toolout'), { recursive: true });
  const cfgP = path.join(base, 'toolout', 'filter.json');
  if (!fs.existsSync(cfgP)) writeFileAtomic(cfgP, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  let cfg = { ...DEFAULT_CONFIG };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgP, 'utf8')) }; } catch { /* default */ }
  const tools   = Array.isArray(cfg.tools) && cfg.tools.length ? cfg.tools : ['Bash'];
  const matcher = tools.join('|');

  const setP = path.join(base, 'settings.json');
  let settings = {};
  // Distinguish "file absent" (start fresh) from "file present but corrupt" — silently
  // overwriting a malformed settings.json would wipe the user's other hooks/permissions.
  try { settings = JSON.parse(fs.readFileSync(setP, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw new Error(`${setP} exists but is not valid JSON — refusing to overwrite it. Fix or remove it, then re-run.`);
    /* ENOENT → new file */
  }
  settings.hooks = settings.hooks || {};
  settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
  // Re-sync: drop any prior token-diet entry, then add one with the matcher from config.
  settings.hooks.PostToolUse = settings.hooks.PostToolUse
    .map(h => ({ ...h, hooks: (h.hooks || []).filter(x => x.command !== HOOK_CMD) }))
    .filter(h => (h.hooks || []).length > 0);
  settings.hooks.PostToolUse.push({ matcher, hooks: [{ type: 'command', command: HOOK_CMD }] });
  writeFileAtomic(setP, JSON.stringify(settings, null, 2) + '\n');

  console.log(`\ntoken-diet filter installed (DISABLED) at ${base}`);
  console.log(`  hook   : PostToolUse [${matcher}] → ${HOOK_CMD}`);
  console.log(`  config : ${cfgP}  (compresses tools: ${tools.join(', ')})`);
  console.log(`\nNext: --self-test → --enable (AUDIT: records what it'd save, no changes) → --report → --activate`);
  console.log(`Tune in filter.json: "tools" (add Read/Grep), "keep" (regexes never collapsed), thresholds.\n`);
}

function runUninstall(opts = {}) {
  const setP = path.join(resolveBase(opts), 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(setP, 'utf8'));
    if (settings.hooks && Array.isArray(settings.hooks.PostToolUse)) {
      settings.hooks.PostToolUse = settings.hooks.PostToolUse
        .map(h => ({ ...h, hooks: (h.hooks || []).filter(x => x.command !== HOOK_CMD) }))
        .filter(h => (h.hooks || []).length > 0);
      // Leave no empty husks behind — a true inverse of install on a from-scratch file.
      if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      writeFileAtomic(setP, JSON.stringify(settings, null, 2) + '\n');
    }
    console.log(`token-diet filter hook removed from ${setP}`);
  } catch { console.log('No settings.json hook to remove.'); }
}

function setState(opts, enabled, mode) {
  const cfgP = path.join(resolveBase(opts), 'toolout', 'filter.json');
  let cfg = { ...DEFAULT_CONFIG };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgP, 'utf8')) }; } catch { /* default */ }
  cfg.enabled = enabled;
  if (mode) cfg.mode = mode;
  fs.mkdirSync(path.dirname(cfgP), { recursive: true });
  writeFileAtomic(cfgP, JSON.stringify(cfg, null, 2) + '\n');
  const state = !enabled ? 'disabled'
    : cfg.mode === 'active' ? 'ACTIVE — compressing output'
    : 'AUDIT — recording what it would save; output UNCHANGED. Review with --report, then --activate';
  console.log(`\ntoken-diet filter: ${state}\n  ${cfgP}\n`);
}
// `--enable` defaults to safe AUDIT mode; `--activate` goes live; `--disable` turns it off.
function setEnabled(opts, enabled) { return setState(opts, enabled, enabled ? 'audit' : undefined); }

// Inline fixtures (shipped in this file — no extra paths to resolve).
const FIXTURES = {
  tests: '===== test session =====\n' + 'test_x.py::a PASSED\n'.repeat(8) +
         'test_x.py::b FAILED\n    assert 1 == 2\nE   AssertionError\n===== 1 failed, 8 passed in 0.4s =====',
  git:   'On branch master\nYour branch is up to date.\nChanges not staged for commit:\n\tmodified:   src/a.js\n\tmodified:   src/b.js\nUntracked files:\n\ttmp.log',
  read:  Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n'),
  log:   'connecting...\n'.repeat(40) + 'done\nresult: ok',
  build: Array.from({ length: 40 }, (_, i) => `   Compiling crate_${i} v1.0.${i}`).join('\n') +
         '\nwarning: unused variable: `x`\n  --> src/main.rs:4:9\n' +
         'error[E0308]: mismatched types\n  --> src/main.rs:10:5\n' +
         '   Finished dev [unoptimized + debuginfo] target(s) in 8.21s',
  json:  JSON.stringify({ status: 'ok', count: 50,
           items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: 'item ' + i, note: 'x'.repeat(300) })) }, null, 2),
};
function runSelfTest() {
  const cfg = { ...DEFAULT_CONFIG, enabled: true };
  const cases = [
    ['tests (pytest)', FIXTURES.tests, t => compressTests(t, cfg)],
    ['git status',     FIXTURES.git,   t => compressGit(t, 'git status', cfg)],
    ['build (cargo)',  FIXTURES.build, t => compressBuild(t, cfg)],
    ['json (api)',     FIXTURES.json,  t => compressJson(t, cfg)],
    ['large read',     FIXTURES.read,  t => compressRead(t, cfg)],
    ['log dedup',      FIXTURES.log,   t => dedupLog(t, cfg)],
  ];
  console.log('\n=== token-diet filter --self-test (fixtures) ===\n');
  for (const [name, input, fn] of cases) {
    const out = fn(input);
    console.log(`▶ ${name}: ${input.split('\n').length}→${out.split('\n').length} lines · ${estTok(input)}→${estTok(out)} tok`);
    console.log(out.split('\n').map(l => '    ' + l).join('\n') + '\n');
  }
  console.log("Fixtures only. Enable on real output with: token-diet filter --enable\n");
}

// ── report: aggregate recorded stats into a measured reduction table ───────────
const KIND_LABEL = { tests: 'tests (pytest/jest/…)', git: 'git (status/diff/log)', build: 'builds (npm/cargo/…)', json: 'JSON (curl/jq/api)', read: 'large file reads', log: 'logs / other output' };

function aggregateStats(entries) {
  const agg = {};
  for (const e of entries) {
    const k = e.kind || 'log';
    (agg[k] = agg[k] || { kind: k, count: 0, raw: 0, comp: 0 });
    agg[k].count++; agg[k].raw += e.rawTok || 0; agg[k].comp += e.compTok || 0;
  }
  const rows = Object.values(agg)
    .map(v => ({ ...v, pct: v.raw ? Math.round(100 * (v.raw - v.comp) / v.raw) : 0 }))
    .sort((a, b) => (b.raw - b.comp) - (a.raw - a.comp));
  const total = rows.reduce((s, r) => ({ count: s.count + r.count, raw: s.raw + r.raw, comp: s.comp + r.comp }),
    { count: 0, raw: 0, comp: 0 });
  total.pct = total.raw ? Math.round(100 * (total.raw - total.comp) / total.raw) : 0;
  return { rows, total };
}

function runReport(opts = {}) {
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  let entries = [];
  try {
    entries = fs.readFileSync(path.join(root, '.claude', 'toolout', 'stats.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* no stats yet */ }

  if (!entries.length) {
    console.log('\nNo filter activity recorded yet. Run `token-diet filter --install --self-test --enable`,\nthen use the project — the table builds from your real tool output.\n');
    return;
  }
  const { rows, total } = aggregateStats(entries);
  if (opts.json) { console.log(JSON.stringify({ rows, total }, null, 2)); return; }

  const fmt = n => Math.round(n).toLocaleString('en-US');
  const pad = (s, w) => String(s).padStart(w);
  const pctStr = p => (p < 0 ? '+' + Math.abs(p) : '-' + p) + '%';   // reduction is "-N%"; growth (rare) is "+N%"
  console.log('\n=== token-diet filter — measured token reduction (your real sessions) ===');
  console.log('  Counts are estimates (token ≈ chars/4 on the output string, not API-billed tokens).\n');
  console.log('  type                   |  calls |     before |      after | reduction');
  console.log('  -----------------------+--------+------------+------------+----------');
  for (const r of rows)
    console.log(`  ${(KIND_LABEL[r.kind] || r.kind).padEnd(22)} | ${pad(r.count, 6)} | ${pad(fmt(r.raw), 10)} | ${pad(fmt(r.comp), 10)} | ${pad(pctStr(r.pct), 8)}`);
  console.log('  -----------------------+--------+------------+------------+----------');
  console.log(`  ${'TOTAL'.padEnd(22)} | ${pad(total.count, 6)} | ${pad(fmt(total.raw), 10)} | ${pad(fmt(total.comp), 10)} | ${pad(pctStr(total.pct), 8)}`);
  console.log(`\n  ${fmt(total.raw - total.comp)} tokens saved across ${total.count} filtered calls (token ≈ chars/4).`);
  console.log('  Tool-output only — for the whole-project effect, use `token-diet compare`.\n');
}

module.exports = {
  DEFAULT_CONFIG, loadConfig, configPath, stripNoise,
  compressTests, compressGit, compressBuild, compressJson, compressRead, dedupLog, looksLikeJson, classify, classifyKind, extractOutput,
  writeSidecar, pruneSidecar, recordStats, compressPayload, runFilter, keepMatcher,
  runInstall, runUninstall, setEnabled, setState, runSelfTest, aggregateStats, runReport,
};

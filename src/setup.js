'use strict';
/**
 * setup.js — one command that wires token-diet's ongoing protection. Deterministic + idempotent.
 *   1. installs the output filter in AUDIT mode (records savings, changes NOTHING)
 *   2. drops a git pre-commit hook that runs `token-diet review` as a drift reminder
 * The only thing left for the user is one switch — `filter --activate` — once they've
 * eyeballed `filter --report`. High-blast-radius things are never silently enabled.
 */
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const filter  = require('./filter');
const review  = require('./review');
const history = require('./history');

const HOOK_MARK = '# token-diet review (drift reminder)';
// Resolve token-diet however it was installed — works global OR project-scoped, no global
// required. Priority: a vendored project copy (.claude/token-diet, the explicit "this project
// is project-scoped" signal) → global PATH → node_modules → npx. If none resolve (e.g. a GUI
// git client with no PATH), it degrades to a no-op instead of blocking the commit.
const HOOK_CMD = [
  'if   [ -f .claude/token-diet/bin/token-diet.js ]; then TD="node .claude/token-diet/bin/token-diet.js"',
  'elif command -v token-diet >/dev/null 2>&1;       then TD="token-diet"',
  'elif [ -x node_modules/.bin/token-diet ];         then TD="node_modules/.bin/token-diet"',
  'elif command -v npx >/dev/null 2>&1;              then TD="npx --no token-diet"',
  'else TD=""; fi',
  '[ -n "$TD" ] && $TD review --dir .   # add --fail-under C to BLOCK commits when the grade regresses',
].join('\n');

// Remove any existing token-diet block (the HOOK_MARK line + the command lines that follow it,
// up to the next blank line or EOF). Handles every past form — old single-line and the current
// multi-line resolver — so an upgrade replaces a stale block instead of duplicating/skipping it.
function stripStaleHook(body) {
  if (!body.includes(HOOK_MARK)) return body;
  const lines = body.split('\n'); const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(HOOK_MARK)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '') j++;   // skip the block's command lines
      i = j - 1;                                                 // loop ++ lands on the blank (kept)
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function installPreCommit(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return { ok: false, reason: 'not a git repo' };
  const hooksDir = path.join(root, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookP = path.join(hooksDir, 'pre-commit');
  let body = '';
  try { body = fs.readFileSync(hookP, 'utf8'); } catch { /* none yet */ }
  const block = `${HOOK_MARK}\n${HOOK_CMD}\n`;
  if (body.includes(block)) return { ok: true, status: 'already present' };   // exact current form
  const stale = body.includes(HOOK_MARK);                                      // an older block exists
  const cleaned = stripStaleHook(body);
  if (!cleaned.trim()) {
    fs.writeFileSync(hookP, '#!/bin/sh\n' + block);
  } else {
    const base = cleaned.startsWith('#!') ? cleaned : '#!/bin/sh\n' + cleaned;
    fs.writeFileSync(hookP, base.replace(/\s*$/, '') + '\n\n' + block);
  }
  try { fs.chmodSync(hookP, 0o755); } catch { /* no-op on Windows */ }
  return { ok: true, status: stale ? 'upgraded existing pre-commit to the current resolver'
                                    : (body ? 'appended to existing pre-commit' : 'created pre-commit') };
}

async function runSetup(opts = {}) {
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  console.log('\n=== token-diet setup — wiring ongoing protection ===');

  // Don't downgrade a filter the user already activated; otherwise start in safe AUDIT.
  // Probe the SAME location the install will write to (honor --global), not always the cwd.
  const base = opts.global ? os.homedir() : root;
  let mode = 'audit';
  try {
    if (JSON.parse(fs.readFileSync(path.join(base, '.claude', 'toolout', 'filter.json'), 'utf8')).mode === 'active') mode = 'active';
  } catch { /* no config yet → audit */ }
  // `--activate` is the opt-in one-command path: wire + go live immediately (skip the audit
  // preview). Default stays AUDIT (records only) so the gate is never crossed silently.
  if (opts.activate) mode = 'active';
  filter.runInstall(opts);             // install the hook (disabled)
  filter.setState(opts, true, mode);   // AUDIT by default, or ACTIVE with --activate / if already live

  const pc = installPreCommit(root);
  console.log(`  pre-commit drift reminder: ${pc.ok ? pc.status : 'skipped — ' + pc.reason}`);

  // Seed a drift baseline so the pre-commit gate can warn when the structure regresses later,
  // even for users who only run `setup` and never the full agent. /token-diet Phase 5 updates it.
  try {
    const r = review.analyze(root, os.homedir());
    if (r.grade !== 'N/A') {
      history.setBaseline(root, { grade: r.grade, findings: r.projectFindings.length, ts: new Date().toISOString() });
      console.log(`  drift baseline: grade ${r.grade} recorded — commits warn if it regresses`);
    }
  } catch { /* best-effort */ }

  if (mode === 'active') {
    console.log('\nWired + LIVE. The filter will COMPRESS verbose tool output automatically.');
    console.log('  • reload Claude Code to start  •  measured savings: token-diet filter --report');
    console.log('  • turn off anytime: token-diet filter --disable  •  full output kept in .claude/toolout/\n');
  } else {
    console.log('\nWired. The filter is RECORDING in audit mode — your output is unchanged.');
    console.log('  • preview savings  : token-diet filter --report');
    console.log('  • go live (1 switch): token-diet filter --activate   (or re-run: token-diet setup --activate)');
    console.log('  • full audit anytime: /token-diet\n');
  }
  // setup keeps a deliberately small, low-blast-radius default (filter audit + drift gate). The other
  // opt-in gates are pointed to here so both modes stay aware of them without silently adding a
  // per-read hook (readgate) or writing a router config the user hasn't asked for.
  console.log('Optional next gates (separate opt-in — not wired by setup):');
  console.log('  • read-path dedup : token-diet readgate --install && token-diet readgate --enable  (audit-first)');
  console.log('  • model routing   : token-diet route --scaffold   (Lever 7 rule table; classify with route --classify)\n');
}

module.exports = { runSetup, installPreCommit, HOOK_MARK };

'use strict';
/**
 * setup.js — one command that wires token-diet's whole hands-off stack. Deterministic + idempotent.
 *   1. installs the output filter (Lever 8) — compresses verbose tool output
 *   2. installs the read-path gate (Lever 3) — denies redundant in-session re-reads
 *   3. drops a git pre-commit hook that runs `token-diet review` as a drift reminder
 * Auto-mode is a SINGLE decision, not a checklist: plain `setup` wires the whole stack in AUDIT
 * (records what it'd save, changes nothing); `setup --activate` brings the whole stack LIVE in one
 * command. The two hooks always move together — never half-wired, never silently crossed.
 */
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const filter   = require('./filter');
const readgate = require('./readgate');
const review   = require('./review');
const history  = require('./history');

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

  // Don't downgrade a hook the user already activated; otherwise start in safe AUDIT. Probe the
  // SAME location each install writes to (honor --global), not always the cwd. `--activate` is the
  // one-command hands-off path: it brings the WHOLE stack live at once. Default stays AUDIT (records
  // only) so the gate is never crossed silently — but the two hooks always move together.
  const base = opts.global ? os.homedir() : root;
  const probeActive = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')).mode === 'active'; } catch { return false; } };
  const live = !!opts.activate;
  const filterMode = live || probeActive(path.join(base, '.claude', 'toolout', 'filter.json'))  ? 'active' : 'audit';
  const gateMode   = live || probeActive(path.join(base, '.claude', 'readgate', 'config.json')) ? 'active' : 'audit';
  filter.runInstall(opts);                  // output filter (Lever 8) — compresses verbose tool output
  filter.setState(opts, true, filterMode);
  readgate.runInstall(opts);                // read-path gate (Lever 3) — denies redundant in-session re-reads
  readgate.setState(opts, true, gateMode);

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

  if (filterMode === 'active' && gateMode === 'active') {
    console.log('\nWired + LIVE (hands-off). The filter COMPRESSES verbose tool output and the readgate');
    console.log('DENIES redundant in-session re-reads — both fully recoverable (full content kept on disk).');
    console.log('  • reload Claude Code to start  •  savings: token-diet filter --report  /  readgate --report');
    console.log('  • turn off anytime: token-diet filter --disable  /  token-diet readgate --disable\n');
  } else {
    console.log('\nWired in AUDIT — the filter and readgate RECORD what they would save; your sessions are unchanged.');
    console.log('  • preview savings  : token-diet filter --report   and   token-diet readgate --report');
    console.log('  • go live, one cmd : token-diet setup --activate   (brings the filter + readgate live together)');
    console.log('  • full audit anytime: /token-diet\n');
  }
  // The remaining tools are NOT background hooks — there is nothing to "activate". route writes a rule
  // table you edit + invoke per task; trace is a read-only diagnostic. So they stay pointers, not wiring.
  console.log('Also available (not background hooks — nothing to activate):');
  console.log('  • model routing   : token-diet route --scaffold   (Lever 7 rule table; classify with route --classify)');
  console.log('  • behavioral waste: token-diet trace   (loops/retries + delegation-fit from real sessions; also surfaced in `savings`)\n');
}

module.exports = { runSetup, installPreCommit, HOOK_MARK };

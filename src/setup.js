'use strict';
/**
 * setup.js — one command that wires token-diet's ongoing protection. Deterministic + idempotent.
 *   1. installs the output filter in AUDIT mode (records savings, changes NOTHING)
 *   2. drops a git pre-commit hook that runs `token-diet review` as a drift reminder
 * The only thing left for the user is one switch — `filter --activate` — once they've
 * eyeballed `filter --report`. High-blast-radius things are never silently enabled.
 */
const fs     = require('fs');
const path   = require('path');
const filter = require('./filter');

const HOOK_MARK = '# token-diet review (drift reminder)';

function installPreCommit(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return { ok: false, reason: 'not a git repo' };
  const hooksDir = path.join(root, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookP = path.join(hooksDir, 'pre-commit');
  let body = '';
  try { body = fs.readFileSync(hookP, 'utf8'); } catch { /* none yet */ }
  if (body.includes(HOOK_MARK)) return { ok: true, status: 'already present' };
  const block = `${HOOK_MARK}\ntoken-diet review --dir .   # add --fail-under C to BLOCK commits when the grade regresses\n`;
  if (body) fs.appendFileSync(hookP, '\n' + block);
  else      fs.writeFileSync(hookP, '#!/bin/sh\n' + block);
  try { fs.chmodSync(hookP, 0o755); } catch { /* no-op on Windows */ }
  return { ok: true, status: body ? 'appended to existing pre-commit' : 'created pre-commit' };
}

async function runSetup(opts = {}) {
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  console.log('\n=== token-diet setup — wiring ongoing protection ===');

  // Don't downgrade a filter the user already activated; otherwise start in safe AUDIT.
  let mode = 'audit';
  try {
    if (JSON.parse(fs.readFileSync(path.join(root, '.claude', 'toolout', 'filter.json'), 'utf8')).mode === 'active') mode = 'active';
  } catch { /* no config yet → audit */ }
  filter.runInstall(opts);             // install the hook (disabled)
  filter.setState(opts, true, mode);   // record in AUDIT (or keep ACTIVE if already live)

  const pc = installPreCommit(root);
  console.log(`  pre-commit drift reminder: ${pc.ok ? pc.status : 'skipped — ' + pc.reason}`);

  console.log('\nWired. The filter is RECORDING in audit mode — your output is unchanged.');
  console.log('  • measured savings : token-diet filter --report');
  console.log('  • go live (1 switch): token-diet filter --activate');
  console.log('  • full audit anytime: /token-diet\n');
}

module.exports = { runSetup, installPreCommit, HOOK_MARK };

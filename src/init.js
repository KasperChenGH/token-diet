'use strict';
/**
 * init.js — make token-diet self-deploying as a Claude Code skill, agent, and command
 *
 * Installs three artifacts into ~/.claude/ (--global) or <cwd>/.claude/ (default):
 *
 *   SKILL.md          → {base}/skills/token-diet/SKILL.md
 *   agents/token-diet.md  → {base}/agents/token-diet.md
 *   commands/token-diet.md → {base}/commands/token-diet.md
 *
 * Source files: package root (__dirname/..)
 * Idempotent — re-running is safe; prints what was written / already up to date.
 *
 * Usage:
 *   token-diet init [--global]
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

async function runInit(opts = {}) {
  const pkgRoot = path.join(__dirname, '..');

  // ── Define the three artifacts ──────────────────────────────────────────────
  // Each entry: { src: relative-to-pkgRoot, destRelative: relative-to-base }
  const artifacts = [
    {
      src:         path.join(pkgRoot, 'SKILL.md'),
      destRelative: path.join('skills', 'token-diet', 'SKILL.md'),
      label:       'skill (SKILL.md)',
    },
    {
      src:         path.join(pkgRoot, 'agents', 'token-diet.md'),
      destRelative: path.join('agents', 'token-diet.md'),
      label:       'agent (agents/token-diet.md)',
    },
    {
      src:         path.join(pkgRoot, 'commands', 'token-diet.md'),
      destRelative: path.join('commands', 'token-diet.md'),
      label:       'command (commands/token-diet.md)',
    },
  ];

  // ── Resolve install base ─────────────────────────────────────────────────────
  const base = opts.global
    ? path.join(os.homedir(), '.claude')
    : path.join(process.cwd(), '.claude');

  const scope = opts.global ? 'global (~/.claude/)' : 'project (.claude/)';
  console.log(`\ntoken-diet init — installing to ${scope}\n`);

  let anyWritten = false;

  for (const artifact of artifacts) {
    // Source must exist
    if (!fs.existsSync(artifact.src)) {
      console.error(`  [ERROR] Source not found: ${artifact.src}`);
      process.exit(1);
    }

    const destPath = path.join(base, artifact.destRelative);
    const destDir  = path.dirname(destPath);

    // Idempotent: check if already up to date
    if (fs.existsSync(destPath)) {
      try {
        const srcContent  = fs.readFileSync(artifact.src,  'utf8');
        const destContent = fs.readFileSync(destPath, 'utf8');
        if (srcContent === destContent) {
          console.log(`  [up to date] ${artifact.label}`);
          console.log(`               ${destPath}`);
          continue;
        }
      } catch { /* proceed with copy */ }
    }

    // Ensure destination directory exists
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (e) {
      console.error(`  [ERROR] Could not create directory ${destDir}: ${e.message}`);
      process.exit(1);
    }

    // Copy
    try {
      fs.copyFileSync(artifact.src, destPath);
    } catch (e) {
      console.error(`  [ERROR] Could not copy ${artifact.label} to ${destPath}: ${e.message}`);
      process.exit(1);
    }

    console.log(`  [installed] ${artifact.label}`);
    console.log(`              ${destPath}`);
    anyWritten = true;
  }

  console.log('');
  if (anyWritten) {
    console.log('Reload Claude Code to activate the skill, agent, and command.');
    console.log('  Skill will appear in available-skills as "token-diet".');
    console.log('  Agent will be usable as agent type "token-diet".');
    console.log('  Command will be available as /token-diet.');
  } else {
    console.log('All token-diet artifacts are already up to date.');
  }
  console.log('');
}

module.exports = { runInit };

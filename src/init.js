'use strict';
/**
 * init.js — make token-diet self-deploying as a Claude Code skill
 *
 * Copies the package's own SKILL.md into:
 *   <cwd>/.claude/skills/token-diet/SKILL.md  (default, project-local)
 *   ~/.claude/skills/token-diet/SKILL.md       (--global)
 *
 * Source: the SKILL.md adjacent to this package (__dirname/../SKILL.md)
 * Idempotent — re-running is safe; prints what was written.
 *
 * Usage:
 *   token-diet init [--global]
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

async function runInit(opts = {}) {
  // Source: SKILL.md in the package root (one level up from src/)
  const srcPath = path.join(__dirname, '..', 'SKILL.md');

  if (!fs.existsSync(srcPath)) {
    console.error(`Source SKILL.md not found at: ${srcPath}`);
    process.exit(1);
  }

  // Destination
  const destBase = opts.global
    ? path.join(os.homedir(), '.claude', 'skills', 'token-diet')
    : path.join(process.cwd(), '.claude', 'skills', 'token-diet');
  const destPath = path.join(destBase, 'SKILL.md');

  // Idempotent: check if already up to date
  let alreadyCurrent = false;
  if (fs.existsSync(destPath)) {
    try {
      const src  = fs.readFileSync(srcPath,  'utf8');
      const dest = fs.readFileSync(destPath, 'utf8');
      if (src === dest) alreadyCurrent = true;
    } catch { /* proceed with copy */ }
  }

  if (alreadyCurrent) {
    console.log(`\ntoken-diet SKILL.md is already up to date at:\n  ${destPath}\n`);
    return;
  }

  // Ensure destination directory exists
  try {
    fs.mkdirSync(destBase, { recursive: true });
  } catch (e) {
    console.error(`Could not create directory ${destBase}: ${e.message}`);
    process.exit(1);
  }

  // Copy
  try {
    fs.copyFileSync(srcPath, destPath);
  } catch (e) {
    console.error(`Could not copy SKILL.md to ${destPath}: ${e.message}`);
    process.exit(1);
  }

  const scope = opts.global ? 'global (~/.claude/skills/)' : 'project (.claude/skills/)';
  console.log(`\ntoken-diet skill installed (${scope}):\n  ${destPath}\n`);
  console.log('Reload Claude Code to activate the skill.');
  console.log('The skill will appear in the available-skills list as "token-diet".\n');
}

module.exports = { runInit };

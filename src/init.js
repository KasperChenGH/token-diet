'use strict';
/**
 * init.js — make token-diet self-deploying as a Claude Code skill, agent, and command
 *
 * Installs into ~/.claude/ (--global) or <cwd>/.claude/ (default):
 *
 *   skills/SKILL.md        → {base}/skills/token-diet/SKILL.md
 *   agents/token-diet.md   → {base}/agents/token-diet.md
 *   agents/subagent-*.md   → {base}/agents/subagent-*.md
 *                            (tier-2 analyst + tier-3 lever specialists, spawned in Phase 2)
 *   commands/token-diet.md → {base}/commands/token-diet.md
 *   references/levers/     → {base}/skills/token-diet/references/levers/*.md
 *                            (per-lever rubric files — the specialist judgment bodies)
 *   skills/shared/         → {base}/skills/token-diet/shared/*.md
 *                            (shared specialist contract referenced via Uses: [[shared/...]])
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

/**
 * Recursively collect all files under srcDir, returning
 * { src: absolutePath, destRelative: path-relative-to-base } objects.
 * destPrefix is the path under base/ where the tree lands.
 */
function collectDirArtifacts(srcDir, destPrefix) {
  const results = [];
  if (!fs.existsSync(srcDir)) return results;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const relDest = path.join(destPrefix, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDirArtifacts(srcPath, relDest));
    } else {
      results.push({ src: srcPath, destRelative: relDest, label: `lever rubric (${entry.name})` });
    }
  }
  return results;
}

async function runInit(opts = {}) {
  const pkgRoot = path.join(__dirname, '..');

  // ── Define the core artifacts ────────────────────────────────────────────────
  // Each entry: { src: absolute-path, destRelative: relative-to-base }
  const artifacts = [
    {
      src:         path.join(pkgRoot, 'skills', 'SKILL.md'),
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
    // Per-lever rubric files — read by Sonnet sub-reviewers during Phase 2
    ...collectDirArtifacts(
      path.join(pkgRoot, 'references', 'levers'),
      path.join('skills', 'token-diet', 'references', 'levers')
    ),
  ];

  // Named subagents (tier-2 analyst + tier-3 lever specialists) → {base}/agents/
  // Without these, the main agent's Phase-2 delegation has no agent type to spawn.
  const agentsDir = path.join(pkgRoot, 'agents');
  for (const f of fs.readdirSync(agentsDir).filter(n => n.startsWith('subagent-') && n.endsWith('.md'))) {
    artifacts.push({ src: path.join(agentsDir, f), destRelative: path.join('agents', f), label: `subagent (${f})` });
  }

  // Shared specialist knowledge referenced by subagents via `Uses: [[shared/...]]`
  // → {base}/skills/token-diet/shared/ (alongside the rubrics the specialists read).
  const sharedDir = path.join(pkgRoot, 'skills', 'shared');
  if (fs.existsSync(sharedDir)) {
    for (const f of fs.readdirSync(sharedDir).filter(n => n.endsWith('.md'))) {
      artifacts.push({ src: path.join(sharedDir, f), destRelative: path.join('skills', 'token-diet', 'shared', f), label: `shared knowledge (${f})` });
    }
  }

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
    console.log('Reload Claude Code to activate the skill, agents, and command.');
    console.log('  Skill will appear in available-skills as "token-diet".');
    console.log('  Agents: "token-diet" (main) + "subagent-*" (analyst + lever specialists).');
    console.log('  Command will be available as /token-diet.');
  } else {
    console.log('All token-diet artifacts are already up to date.');
  }
  console.log('');
}

module.exports = { runInit };

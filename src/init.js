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
 *   references/subagents/  → {base}/skills/token-diet/references/subagents/*.md
 *                            (per-subagent private knowledge, named subagent-<role>.md;
 *                             also INLINED into the matching deployed agent)
 *   skills/shared/         → {base}/skills/token-diet/shared/*.md
 *                            (shared contract — also INLINED into each deployed subagent,
 *                             since spawned subagents can't bundle/resolve companion files)
 *
 * Subagent files are deployed self-contained: each one's rubric + shared contract are
 * appended to its body at install time (see composeSubagentBody).
 *
 * Source files: package root (__dirname/..)
 * Idempotent — re-running is safe; prints what was written / already up to date.
 *
 * Usage:
 *   token-diet init [--global] [--dir <path>]   (precedence: --global > --dir > cwd)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Recursively collect all files under srcDir, returning
 * { src: absolutePath, destRelative: path-relative-to-base } objects.
 * destPrefix is the path under base/ where the tree lands.
 */
function collectDirArtifacts(srcDir, destPrefix, kind = 'lever rubric') {
  const results = [];
  if (!fs.existsSync(srcDir)) return results;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const relDest = path.join(destPrefix, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDirArtifacts(srcPath, relDest, kind));
    } else {
      results.push({ src: srcPath, destRelative: relDest, label: `${kind} (${entry.name})` });
    }
  }
  return results;
}

/**
 * Inline a subagent's referenced rubric + shared contract into its body so the
 * DEPLOYED agent is self-contained. Spawned subagents run with the user's project
 * (not ~/.claude) as their working directory and cannot bundle companion files, so
 * a bare `references/levers/...` path would not resolve at runtime. We append the
 * referenced content directly into the system prompt instead.
 */
function composeSubagentBody(srcPath, pkgRoot) {
  let body = fs.readFileSync(srcPath, 'utf8').trimEnd();
  const seen = new Set();
  for (const m of body.matchAll(/references\/levers\/(lever-\d+-[a-z0-9-]+\.md)/gi)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const rp = path.join(pkgRoot, 'references', 'levers', m[1]);
    if (fs.existsSync(rp))
      body += `\n\n---\n\n## Rubric (inlined at install — use this; do NOT read a file for it)\n\n` +
              fs.readFileSync(rp, 'utf8').trimEnd();
  }
  // Per-subagent private knowledge: references/subagents/<this agent's filename>.md.
  // Skip unfilled stubs (any line starting with `_Stub`, case-insensitive) so empty
  // placeholders never pollute a deployed agent — a Private-knowledge section appears
  // only once the file is authored.
  const ownPath = path.join(pkgRoot, 'references', 'subagents', path.basename(srcPath));
  if (fs.existsSync(ownPath)) {
    const own = fs.readFileSync(ownPath, 'utf8');
    if (!/^_stub\b/im.test(own))
      body += `\n\n---\n\n## Private knowledge (inlined at install)\n\n` + own.trimEnd();
  }
  for (const m of body.matchAll(/\[\[shared\/([a-z0-9-]+)\]\]/gi)) {
    const key = 'shared/' + m[1];
    if (seen.has(key)) continue; seen.add(key);
    const sp = path.join(pkgRoot, 'skills', 'shared', m[1] + '.md');
    if (fs.existsSync(sp))
      body += `\n\n---\n\n## Shared: ${m[1]} (inlined at install)\n\n` +
              fs.readFileSync(sp, 'utf8').trimEnd();
  }
  return body + '\n';
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
    // Per-subagent private knowledge — also inlined into each agent (belt-and-suspenders)
    ...collectDirArtifacts(
      path.join(pkgRoot, 'references', 'subagents'),
      path.join('skills', 'token-diet', 'references', 'subagents'),
      'subagent knowledge'
    ),
  ];

  // Named subagents (tier-2 analyst + tier-3 lever specialists) → {base}/agents/
  // Without these, the main agent's Phase-2 delegation has no agent type to spawn.
  const agentsDir = path.join(pkgRoot, 'agents');
  for (const f of fs.readdirSync(agentsDir).filter(n => n.startsWith('subagent-') && n.endsWith('.md'))) {
    // Deploy with the rubric + shared contract inlined so the agent is self-contained.
    artifacts.push({ content: composeSubagentBody(path.join(agentsDir, f), pkgRoot), destRelative: path.join('agents', f), label: `subagent (${f})` });
  }

  // Shared specialist knowledge referenced by subagents via `Uses: [[shared/...]]`.
  // Also deployed as standalone files (alongside the rubrics) for human reference;
  // the running subagents use the inlined copy above, so this is belt-and-suspenders.
  const sharedDir = path.join(pkgRoot, 'skills', 'shared');
  if (fs.existsSync(sharedDir)) {
    for (const f of fs.readdirSync(sharedDir).filter(n => n.endsWith('.md'))) {
      artifacts.push({ src: path.join(sharedDir, f), destRelative: path.join('skills', 'token-diet', 'shared', f), label: `shared knowledge (${f})` });
    }
  }

  // ── Resolve install base (precedence: --global > --dir > cwd) ─────────────────
  const installRoot = opts.global ? os.homedir()
                    : (opts.dir ? path.resolve(opts.dir) : process.cwd());
  const base  = path.join(installRoot, '.claude');
  const scope = opts.global ? `global (${base})` : `project (${base})`;
  console.log(`\ntoken-diet init — installing to ${scope}\n`);

  let anyWritten = false;

  for (const artifact of artifacts) {
    // Resolve content to write: precomposed (subagents) or a plain file read.
    let data;
    try {
      data = artifact.content != null ? artifact.content : fs.readFileSync(artifact.src, 'utf8');
    } catch {
      console.error(`  [ERROR] Source not found: ${artifact.src}`);
      process.exit(1);
    }

    const destPath = path.join(base, artifact.destRelative);
    const destDir  = path.dirname(destPath);

    // Idempotent: skip if the destination already matches exactly
    if (fs.existsSync(destPath)) {
      try {
        if (fs.readFileSync(destPath, 'utf8') === data) {
          console.log(`  [up to date] ${artifact.label}`);
          console.log(`               ${destPath}`);
          continue;
        }
      } catch { /* proceed with write */ }
    }

    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(destPath, data);
    } catch (e) {
      console.error(`  [ERROR] Could not write ${artifact.label} to ${destPath}: ${e.message}`);
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

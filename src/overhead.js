'use strict';
/**
 * overhead.js — static always-loaded token burden (Lever 6)
 *
 * Scans files that load into EVERY spawned agent context:
 *   - <dir>/CLAUDE.md
 *   - ~/.claude/CLAUDE.md
 *   - <dir>/.claude/commands/*.md
 *   - <dir>/.claude/skills/*​/SKILL.md
 *   - ~/.claude/skills/*​/SKILL.md
 *
 * Reports: file, lines, est_tokens (bytes/4), scope (per-session / per-spawn)
 * Key insight: CLAUDE.md-type files load into EVERY spawned subagent — shows
 * "cost per round if N agents spawned" for N=1/5/10.
 * Flags files > ~100 lines as trim candidates.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function padL(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }
function hline(ws)  { return ws.map(w => '-'.repeat(w)).join('-+-'); }

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch { return 0; }
}

function estTokens(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return Math.round(stat.size / 4);
  } catch { return 0; }
}

/** Glob one level of subdirectory entries matching a filename pattern */
function globSkillFiles(baseDir, filename) {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;
  let entries;
  try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    if (e.isDirectory()) {
      const candidate = path.join(baseDir, e.name, filename);
      if (fs.existsSync(candidate)) results.push(candidate);
    }
  }
  return results;
}

/** Glob *.md files directly inside a directory */
function globMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      results.push(path.join(dir, e.name));
    }
  }
  return results;
}

async function runOverhead(opts = {}) {
  const targetDir = opts.dir
    ? path.resolve(opts.dir)
    : process.cwd();
  const home = os.homedir();

  // Collect all candidate files with their scope labels
  const candidates = [];

  // 1. Project CLAUDE.md (per-session AND per-spawn — loaded into every agent)
  const projClaude = path.join(targetDir, 'CLAUDE.md');
  if (fs.existsSync(projClaude)) {
    candidates.push({ file: projClaude, scope: 'per-spawn', label: 'project CLAUDE.md' });
  }

  // 2. Global ~/.claude/CLAUDE.md (per-spawn)
  const globalClaude = path.join(home, '.claude', 'CLAUDE.md');
  if (fs.existsSync(globalClaude)) {
    candidates.push({ file: globalClaude, scope: 'per-spawn', label: 'global CLAUDE.md' });
  }

  // 3. Project commands: <dir>/.claude/commands/*.md (per-session, loaded on demand but
  //    slash-command help text is present in every context)
  const projCommandsDir = path.join(targetDir, '.claude', 'commands');
  for (const f of globMdFiles(projCommandsDir)) {
    candidates.push({ file: f, scope: 'per-session', label: 'project command' });
  }

  // 4. Project skills: <dir>/.claude/skills/*/SKILL.md (per-spawn when skill is active)
  const projSkillsDir = path.join(targetDir, '.claude', 'skills');
  for (const f of globSkillFiles(projSkillsDir, 'SKILL.md')) {
    candidates.push({ file: f, scope: 'per-spawn', label: 'project skill' });
  }

  // 5. Global skills: ~/.claude/skills/*/SKILL.md (per-spawn when skill is active)
  const globalSkillsDir = path.join(home, '.claude', 'skills');
  for (const f of globSkillFiles(globalSkillsDir, 'SKILL.md')) {
    candidates.push({ file: f, scope: 'per-spawn', label: 'global skill' });
  }

  if (candidates.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ files: [], totals: {}, agentCost: {} }, null, 2));
    } else {
      console.log('No always-loaded files found in the target directory.');
    }
    return;
  }

  // Enrich with metrics
  const rows = candidates.map(c => ({
    ...c,
    lines:   countLines(c.file),
    tokens:  estTokens(c.file),
    trim:    countLines(c.file) > 100,
  }));

  // Per-spawn rows only (loads into every agent)
  const perSpawnRows = rows.filter(r => r.scope === 'per-spawn');
  const perSpawnTotal = perSpawnRows.reduce((s, r) => s + r.tokens, 0);

  // Per-session rows (loaded once per top-level session)
  const perSessionRows = rows.filter(r => r.scope === 'per-session');
  const perSessionTotal = perSessionRows.reduce((s, r) => s + r.tokens, 0);

  if (opts.json) {
    const output = {
      files: rows.map(r => ({
        file:   r.file,
        label:  r.label,
        scope:  r.scope,
        lines:  r.lines,
        est_tokens: r.tokens,
        trim_candidate: r.trim,
      })),
      totals: {
        per_spawn_tokens:   perSpawnTotal,
        per_session_tokens: perSessionTotal,
      },
      agentCost: {
        agents_1:  perSpawnTotal * 1,
        agents_5:  perSpawnTotal * 5,
        agents_10: perSpawnTotal * 10,
      },
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // ── Human-readable table ──────────────────────────────────────────────────
  console.log('\n=== Static Always-Loaded Overhead (Lever 6) ===\n');
  console.log(`Scanned directory: ${targetDir}\n`);

  const colW    = [55, 13, 8, 11, 5];
  const headers = ['file', 'scope', 'lines', 'est_tokens', 'trim?'];
  console.log(headers.map((h, i) => i < 2 ? padL(h, colW[i]) : padR(h, colW[i])).join(' | '));
  console.log(hline(colW));

  for (const r of rows) {
    const shortPath = r.file.length > 53
      ? '...' + r.file.slice(-(53))
      : r.file;
    const cols = [
      shortPath,
      r.scope,
      String(r.lines),
      fmt(r.tokens),
      r.trim ? 'YES' : '',
    ];
    console.log(cols.map((c, i) => i < 2 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));
  }

  console.log(hline(colW));

  // Totals line
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  const totalLines  = rows.reduce((s, r) => s + r.lines, 0);
  const tCols = [
    'TOTAL', '',
    String(totalLines),
    fmt(totalTokens),
    '',
  ];
  console.log(tCols.map((c, i) => i < 2 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));

  // ── Key insight: per-spawn cost scaled by agent count ─────────────────────
  console.log('\n--- Per-spawn cost (files loaded into EVERY subagent) ---\n');
  console.log(`  per-spawn total:  ${fmt(perSpawnTotal)} tokens\n`);
  console.log('  Cost per round if N agents spawned:');
  for (const n of [1, 5, 10]) {
    const cost = perSpawnTotal * n;
    console.log(`    N=${n.toString().padEnd(3)}  ${fmt(cost).padStart(10)} tokens`);
  }

  // ── Trim candidates ───────────────────────────────────────────────────────
  const trimCandidates = rows.filter(r => r.trim);
  if (trimCandidates.length > 0) {
    console.log('\n--- Trim candidates (> 100 lines) ---\n');
    for (const r of trimCandidates) {
      const shortPath = r.file.length > 70 ? '...' + r.file.slice(-67) : r.file;
      console.log(`  ${shortPath}`);
      console.log(`    ${r.lines} lines  ~${fmt(r.tokens)} tokens  [${r.scope}]`);
      console.log('    Action: trim to <=90 lines; move depth to on-demand reference files\n');
    }
  } else {
    console.log('\n  No files exceed 100 lines — overhead looks lean.\n');
  }
}

module.exports = { runOverhead };

'use strict';
/**
 * collectors.js — shared static-scan helpers for review/estimate.
 * One source of truth: globbing .claude/ design files + the detection regexes.
 */
const fs   = require('fs');
const path = require('path');

const SPAWN_RE   = /subagent|spawn|agent tool|parallel agents|\bN subagents\b|fan[- ]out|\bSubagent \d/gi;
const STEP_RE    = /^#+\s*Step [1-9]/gim;
// Verbose tool-output signals — drives estimate's tool-output weighting (Lever 8).
// Distinct from review.js's COMPUTE_RE, which detects in-session compute duration (Lever 3).
const TOOLOUT_RE = /\b(build|compile|test suite|test|train|backtest|sweep|npm install|docker|webpack|log)\b/gi;

// Per-extension chars/token ratios (calibrated against published values from
// claude-context-optimizer's measurements: prose/markdown packs looser than code, JSON
// tighter). Refines the old flat bytes/4. _default keeps the 4.0 baseline for unknown types.
const CHARS_PER_TOKEN = {
  '.md': 4.2, '.markdown': 4.2, '.txt': 4.2,
  '.json': 3.2, '.yaml': 4.0, '.yml': 4.0, '.toml': 4.0,
  '.js': 3.8, '.ts': 3.8, '.jsx': 3.8, '.tsx': 3.8, '.mjs': 3.8, '.cjs': 3.8,
  '.py': 3.8, '.go': 3.8, '.rs': 3.8, '.java': 3.8,
  _default: 4.0,
};
function charsPerToken(filePath) {
  return CHARS_PER_TOKEN[path.extname(String(filePath)).toLowerCase()] || CHARS_PER_TOKEN._default;
}

// Vendor-calibrated policy thresholds (first-pass guesses replaced with published numbers):
//   OFFLOAD_TOKENS   — LangChain Deep Agents offloads a tool result / file over ~20k tokens
//                      to the filesystem instead of holding it in context.
//   CONTEXT_WINDOW   — modeled window for the truncate gate (200k for current Claude).
//   TRUNCATE_AT_PCT  — Deep Agents truncates conversation history at ~85% of the window.
const OFFLOAD_TOKENS  = 20000;
const CONTEXT_WINDOW  = 200000;
const TRUNCATE_AT_PCT = 0.85;

function estTokens(filePath) {
  try { return Math.round(fs.statSync(filePath).size / charsPerToken(filePath)); } catch { return 0; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function globMdFiles(dir) {
  const r = [];
  if (!fs.existsSync(dir)) return r;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
      if (e.isFile() && e.name.endsWith('.md')) r.push(path.join(dir, e.name));
  } catch { /* unreadable */ }
  return r;
}
function globSkillFiles(baseDir, filename) {
  const r = [];
  if (!fs.existsSync(baseDir)) return r;
  try {
    for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const c = path.join(baseDir, e.name, filename);
        if (fs.existsSync(c)) r.push(c);
      }
    }
  } catch { /* unreadable */ }
  return r;
}

/** Per-spawn = CLAUDE.md + skills (load into every agent); per-session = commands. */
function collectOverhead(targetDir, home) {
  const perSpawn = [], perSession = [];
  const projClaude = path.join(targetDir, 'CLAUDE.md');
  if (fs.existsSync(projClaude)) perSpawn.push(projClaude);
  const globalClaude = path.join(home, '.claude', 'CLAUDE.md');
  if (fs.existsSync(globalClaude)) perSpawn.push(globalClaude);
  for (const f of globSkillFiles(path.join(targetDir, '.claude', 'skills'), 'SKILL.md')) perSpawn.push(f);
  for (const f of globSkillFiles(path.join(home, '.claude', 'skills'), 'SKILL.md'))       perSpawn.push(f);
  for (const f of globMdFiles(path.join(targetDir, '.claude', 'commands'))) perSession.push(f);
  for (const f of globMdFiles(path.join(home, '.claude', 'commands')))       perSession.push(f);
  const sum = arr => arr.reduce((s, f) => s + estTokens(f), 0);
  return {
    perSpawnFiles: perSpawn, perSessionFiles: perSession,
    perSpawnTotal: sum(perSpawn), perSessionTotal: sum(perSession),
  };
}

/** Command/agent/skill files (with content) used for lever signal detection. */
function collectCommandFiles(targetDir, home) {
  const files = [];
  const add = arr => { for (const f of arr) files.push({ file: f, content: readText(f) }); };
  add(globMdFiles(path.join(targetDir, '.claude', 'commands')));
  add(globMdFiles(path.join(targetDir, '.claude', 'agents')));
  add(globSkillFiles(path.join(targetDir, '.claude', 'skills'), 'SKILL.md'));
  return files;
}

module.exports = {
  SPAWN_RE, STEP_RE, TOOLOUT_RE,
  CHARS_PER_TOKEN, charsPerToken, OFFLOAD_TOKENS, CONTEXT_WINDOW, TRUNCATE_AT_PCT,
  estTokens, readText, globMdFiles, globSkillFiles,
  collectOverhead, collectCommandFiles,
};

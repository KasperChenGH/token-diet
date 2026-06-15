'use strict';
/**
 * collectors.js — shared static-scan helpers for review/estimate.
 * One source of truth: globbing .claude/ design files + the detection regexes.
 */
const fs   = require('fs');
const path = require('path');

const SPAWN_RE   = /subagent|spawn|agent tool|parallel agents|\bN subagents\b|fan[- ]out|\bSubagent \d/gi;
const STEP_RE    = /^#+\s*Step [1-9]/gim;
const COMPUTE_RE = /\b(build|compile|test suite|test|train|backtest|sweep|npm install|docker|webpack|log)\b/gi;

function estTokens(filePath) {
  try { return Math.round(fs.statSync(filePath).size / 4); } catch { return 0; }
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
  SPAWN_RE, STEP_RE, COMPUTE_RE,
  estTokens, readText, globMdFiles, globSkillFiles,
  collectOverhead, collectCommandFiles,
};

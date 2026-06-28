'use strict';
/**
 * compact.js — Lever 2 made executable: a deterministic {intent, artifacts, next-steps} handover
 * from a real session, so the next session (or post-/clear) resumes from a compact state doc instead
 * of re-establishing context. Deterministic skeleton (token-diet's "scripts compute, LLM judges");
 * the model only refines wording. Consumes scan (the single coupling point).
 */
const { scanAll } = require('./scan');
const fs   = require('fs');
const path = require('path');

// File-writing tools only — these produce the "files changed" artifacts. Deliberately NARROWER than
// trace.js's MUTATING_TOOLS (which also excludes Task*/Todo* tools from loop detection): a TodoWrite
// is not a file artifact, so it must not land in the handover's file list.
const FILE_MUTATING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Pick the target session: --session <id-prefix>, else the most recently active.
function pickSession(records, opts = {}) {
  const byFile = new Map();
  for (const r of records) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
  if (opts.session) {
    for (const [f, recs] of byFile) if (path.basename(f).startsWith(opts.session)) return { file: f, recs };
    return null;
  }
  let best = null, bestTs = -1;
  for (const [file, recs] of byFile) {
    const ts = recs.reduce((m, r) => { const t = r.timestamp ? Date.parse(r.timestamp) : NaN; return isNaN(t) ? m : Math.max(m, t); }, 0);
    if (ts > bestTs) { bestTs = ts; best = { file, recs }; }
  }
  return best;
}

// Deterministically extract artifacts (files edited/written, git commits) + next-steps (open TODOs).
function extractArtifacts(recs, meta = {}) {
  const files = new Set();
  for (const r of recs) for (const tc of (r.toolCalls || [])) if (FILE_MUTATING.has(tc.name) && tc.filePath) files.add(tc.filePath);
  const byId = meta.toolCallsById instanceof Map ? meta.toolCallsById : new Map(Object.entries(meta.toolCallsById || {}));
  const commits = []; let lastTodos = null;
  for (const [, v] of byId) {
    const cmd = v.input && v.input.command;
    if ((v.name === 'Bash' || v.name === 'PowerShell') && cmd && /git\s+commit/.test(cmd)) {
      const m = cmd.match(/-m\s+['"]?([^'"\n]+)/); if (m) commits.push(m[1].trim());
    }
    if (v.name === 'TodoWrite' && v.input && Array.isArray(v.input.todos)) lastTodos = v.input.todos;
  }
  const nextSteps = lastTodos
    ? lastTodos.filter(t => t && t.status !== 'completed').map(t => (t.content || t.activeForm || '')).filter(Boolean)
    : [];
  return { files: [...files], commits, nextSteps };
}

function renderHandover({ id, intent, files, commits, nextSteps, calls }) {
  const L = [`# Session handover — ${id}`, ''];
  L.push('## intent', intent || '_(opening prompt not captured — fill in the goal)_', '');
  L.push('## artifacts', `- ${calls} API calls this session`);
  for (const c of commits) L.push(`- commit: ${c}`);
  if (files.length) { L.push(`- files changed (${files.length}):`); for (const f of files.slice(0, 30)) L.push(`  - ${f}`); }
  if (!commits.length && !files.length) L.push('- _(no file edits or commits detected)_');
  L.push('', '## next-steps');
  if (nextSteps.length) for (const s of nextSteps) L.push(`- [ ] ${s}`);
  else L.push('- _(no open TODOs detected — fill in the remaining work)_');
  L.push('', '_Deterministic skeleton from `token-diet compact`; refine intent / next-steps as needed._');
  return L.join('\n');
}

async function runCompact(opts = {}) {
  const { records, fileMeta } = await scanAll({ days: opts.days != null ? +opts.days : 7, project: opts.project || null });
  if (!records.length) { console.log('\nNo session activity in the window.\n'); return; }
  const sess = pickSession(records, opts);
  if (!sess) { console.log(`\nNo session matched --session ${opts.session}.\n`); return; }
  const meta = (fileMeta && fileMeta.get) ? (fileMeta.get(sess.file) || {}) : {};
  const intent = (meta.firstUserText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const { files, commits, nextSteps } = extractArtifacts(sess.recs, meta);
  const md = renderHandover({ id: path.basename(sess.file, '.jsonl').slice(0, 8), intent, files, commits, nextSteps, calls: sess.recs.length });
  if (opts.out) { fs.writeFileSync(path.resolve(opts.out), md + '\n'); console.log(`Handover written to ${opts.out}`); }
  else console.log('\n' + md + '\n');
}

module.exports = { runCompact, pickSession, extractArtifacts, renderHandover };

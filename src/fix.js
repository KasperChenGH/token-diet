'use strict';
/** fix.js — deterministic apply kernel for diet-changeset.json. No LLM. */
const fs   = require('fs');
const path = require('path');

function applyMove(item, root) {
  const from = path.join(root, item.from);
  const to   = path.join(root, item.to);
  const raw  = fs.readFileSync(from, 'utf8');
  const firstPointerLine = (item.pointer || '').split('\n')[0];
  if (firstPointerLine && raw.includes(firstPointerLine)) {
    return { id: item.id, op: 'move', status: 'skipped (already applied)' };
  }
  const src = raw.split('\n');
  const { fromLine, toLine } = item.region;
  const moved = src.slice(fromLine - 1, toLine).join('\n');
  // MOVE = MOVE-NOT-DELETE: write destination FIRST, so a crash never loses content.
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.appendFileSync(to, (fs.existsSync(to) && fs.statSync(to).size > 0 ? '\n' : '') + moved + '\n');
  // THEN rewrite source: head + pointer + tail.
  const head = src.slice(0, fromLine - 1);
  const tail = src.slice(toLine);
  fs.writeFileSync(from, [...head, item.pointer, ...tail].join('\n'));
  return { id: item.id, op: 'move', status: 'moved' };
}

function applyWrite(item, root) {
  const to = path.join(root, item.to);
  if (fs.existsSync(to) && !item.overwrite) {
    return { id: item.id, op: 'write', status: 'skipped (exists, no overwrite)' };
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, item.content);
  return { id: item.id, op: 'write', status: 'wrote' };
}

const TEMPLATES = {
  'toolout-filter':
    '#!/usr/bin/env bash\n# token-diet Lever 8 output filter is now a BUILT-IN engine.\n' +
    '# Install (disabled), verify on samples, then enable:\n' +
    '#   token-diet filter --install\n#   token-diet filter --self-test\n#   token-diet filter --enable\n' +
    '# Full output -> .claude/toolout/<ts>.log; compressed view -> context; fail-safe on error.\n',
  'driver-script':
    '#!/usr/bin/env bash\n# token-diet driver skeleton — run long compute OUTSIDE the session.\n' +
    '# skeleton — fill in your actual command\n',
};

function applyScaffold(item, root) {
  if (!(item.template in TEMPLATES)) {
    return { id: item.id, op: 'scaffold', status: `ERROR unknown template: ${item.template}` };
  }
  const to = path.join(root, item.to);
  if (fs.existsSync(to)) return { id: item.id, op: 'scaffold', status: 'skipped (exists)' };
  let body = TEMPLATES[item.template];
  if (item.disabled) {
    body = body.split('\n').map(l => (l && !l.startsWith('#')) ? '# ' + l : l).join('\n');
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, body);
  return { id: item.id, op: 'scaffold', status: item.disabled ? 'scaffolded (disabled)' : 'scaffolded' };
}

function applyCommentMarker(item, root) {
  const file = path.join(root, item.file);
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(item.text)) {
    return { id: item.id, op: 'comment-marker', status: 'skipped (present)' };
  }
  const lines = content.split('\n');
  let insertAt = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) insertAt = end + 1;
  }
  lines.splice(insertAt, 0, item.text);
  fs.writeFileSync(file, lines.join('\n'));
  return { id: item.id, op: 'comment-marker', status: 'inserted' };
}

const OPS = { move: applyMove, write: applyWrite, scaffold: applyScaffold, 'comment-marker': applyCommentMarker };

function runFix(opts = {}) {
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const csPath = path.resolve(opts.changeset || path.join(root, 'diet-changeset.json'));
  const cs = JSON.parse(fs.readFileSync(csPath, 'utf8'));
  let items = cs.items;
  if (opts.only != null) {
    const ids = String(opts.only).split(',').map(s => parseInt(s.trim(), 10));
    items = items.filter(it => ids.includes(it.id));
  }
  const results = [];
  for (const item of items) {
    if (opts.dryRun) { results.push({ id: item.id, op: item.op, status: '(dry-run)' }); continue; }
    const fn = OPS[item.op];
    if (!fn) { results.push({ id: item.id, op: item.op, status: 'ERROR unknown op' }); break; }
    let r; try { r = fn(item, root); } catch (e) { r = { id: item.id, op: item.op, status: 'ERROR ' + e.message }; }
    results.push(r);
    if (/^ERROR/.test(r.status)) break;   // abort remaining on first failure
  }
  if (!opts._silent) {
    if (opts.json) console.log(JSON.stringify({ applied: results }, null, 2));
    else { console.log(`\n=== token-diet fix ${opts.dryRun ? '(dry-run)' : ''} ===\n`); results.forEach(r => console.log(`  [${r.id}] ${r.op}: ${r.status}`)); console.log(''); }
  }
  return results;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { ok: true };
  const end = content.indexOf('\n---', 3);
  if (end < 0) return { ok: false, error: 'unterminated frontmatter' };
  return { ok: true };
}
function checkPointers(content, root) {
  const errs = [];
  for (const m of content.matchAll(/Uses:\s*\[\[shared\/([a-z0-9-]+)\]\]/gi)) {
    if (!fs.existsSync(path.join(root, 'skills', 'shared', m[1] + '.md')))
      errs.push(`missing shared skill: shared/${m[1]}`);
  }
  for (const m of content.matchAll(/Tools:\s*(\S+\.js)/gi)) {
    if (!fs.existsSync(path.join(root, m[1]))) errs.push(`missing tool script: ${m[1]}`);
  }
  return errs;
}
function runVerify(opts = {}) {
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const csPath = path.resolve(opts.changeset || path.join(root, 'diet-changeset.json'));
  const cs = JSON.parse(fs.readFileSync(csPath, 'utf8'));
  const targets = new Set();
  for (const it of cs.items) for (const k of ['to', 'from', 'file']) if (it[k]) targets.add(path.join(root, it[k]));
  const problems = [];
  for (const t of targets) {
    if (!fs.existsSync(t) || !t.endsWith('.md')) continue;
    const content = fs.readFileSync(t, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm.ok) problems.push(`${t}: ${fm.error}`);
    for (const e of checkPointers(content, root)) problems.push(`${t}: ${e}`);
  }
  if (!opts._silent) {
    if (problems.length) { console.error('fix --verify FAILED:'); problems.forEach(p => console.error('  ' + p)); }
    else console.log('fix --verify OK');
  }
  return problems;
}

module.exports = { applyMove, applyWrite, applyScaffold, applyCommentMarker, runFix, runVerify };

'use strict';
/** changeset.js — build the diet-changeset.json SKELETON from review findings.
 *  Deterministic op + target per lever; specialists fill `content` later. */
const fs   = require('fs');
const path = require('path');
const review   = require('./review');
const estimate = require('./estimate');

function relTo(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
function lineCount(file)   { try { return fs.readFileSync(file, 'utf8').split('\n').length; } catch { return 0; } }

// Build a "move-not-delete" stub that's a path POINTER + an N-line PREVIEW of the moved content
// (Deep Agents' file-pointer-plus-preview) — so the evicted depth stays visibly retrievable, not
// a bare "see other file". First line is stable ('# Deep Reference') for fix.js's idempotency check.
const PREVIEW_LINES = 5;
function buildPointer(file, region, dest) {
  let preview = [];
  let moreCount = 0;
  try {
    const all = fs.readFileSync(file, 'utf8').split('\n');
    const from = Math.max(1, region.fromLine) - 1;
    const slice = all.slice(from, region.toLine);
    preview = slice.slice(0, PREVIEW_LINES).map(l => '> ' + l.replace(/^#+\s*/, '').trim()).filter(l => l !== '> ');
    moreCount = Math.max(0, slice.length - preview.length);
  } catch { /* unreadable — pointer-only */ }
  const lines = [`# Deep Reference`, ``, `Moved to \`${dest}\` to keep this file lean (Lever 6). Preview:`, ``, ...preview];
  if (moreCount > 0) lines.push(`> … (+${moreCount} more lines in \`${dest}\`)`);
  lines.push(``, `Full content: \`${dest}\``);
  return lines.join('\n');
}

const OP_FOR_LEVER = {
  6: (f, root) => {
    const base = path.basename(f.file).replace(/\.md$/i, '');
    const region = { fromLine: 91, toLine: Math.max(91, lineCount(f.file)) };
    const dest = `${base}-reference.md`;
    return { op: 'move', from: relTo(root, f.file), region, to: dest,
             pointer: buildPointer(f.file, region, dest) };
  },
  5: (f) => ({ op: 'write', to: `knowledge/digests/${path.basename(f.file)}-digest.md`, content: null }),
  8: () => ({ op: 'scaffold', template: 'toolout-filter', to: 'scripts/toolout-filter.sh', disabled: true }),
  1: (f, root) => ({ op: 'comment-marker', file: relTo(root, f.file), anchor: 'top',
    text: '<!-- token-diet: removal candidate — no parallelism/isolation/arbitrage justification. Review before deleting. -->' }),
  7: (f, root) => ({ op: 'comment-marker', file: relTo(root, f.file), anchor: 'top',
    text: '<!-- token-diet: route to sonnet/haiku — mechanical work, no synthesis needed -->' }),
};
// Levers that need a real .md FILE (not a dir/summary finding) for move/comment ops.
const NEEDS_FILE = new Set([1, 6, 7]);

function buildChangeset(targetDir, home) {
  const { projectFindings } = review.analyze(targetDir, home);
  const modeled = [1, 4, 5, 6, 8];
  const flagged = [...new Set(projectFindings.map(f => f.lever))].filter(l => modeled.includes(l));
  const inp = estimate.deriveInputs(targetDir, home, {});
  const s = flagged.length ? estimate.savings(inp, flagged, {}) : { savers: [] };
  const savedByLever = {}; for (const x of s.savers) savedByLever[x.lever] = x.weightedSaved;

  const items = [];
  const seen = new Set();
  let id = 1;
  for (const f of projectFindings) {
    const make = OP_FOR_LEVER[f.lever];
    if (!make) continue;
    if (NEEDS_FILE.has(f.lever) && !String(f.file).endsWith('.md')) continue; // skip dir/summary findings
    const op = make(f, targetDir);
    const key = `${f.lever}:${op.to || op.file || op.from}`;
    if (seen.has(key)) continue; seen.add(key);
    items.push({ id: id++, lever: f.lever, desc: f.recommendation || f.evidence,
                 est_saved_weighted: savedByLever[f.lever] || 0, ...op });
  }
  return { items };
}

module.exports = { buildChangeset, buildPointer };

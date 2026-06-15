'use strict';
/** changeset.js — build the diet-changeset.json SKELETON from review findings.
 *  Deterministic op + target per lever; specialists fill `content` later. */
const fs   = require('fs');
const path = require('path');
const review   = require('./review');
const estimate = require('./estimate');

function relTo(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
function lineCount(file)   { try { return fs.readFileSync(file, 'utf8').split('\n').length; } catch { return 0; } }

const OP_FOR_LEVER = {
  6: (f, root) => {
    const base = path.basename(f.file).replace(/\.md$/i, '');
    return { op: 'move', from: relTo(root, f.file),
             region: { fromLine: 91, toLine: Math.max(91, lineCount(f.file)) },
             to: `${base}-reference.md`, pointer: `# Deep Reference\nSee ${base}-reference.md` };
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

module.exports = { buildChangeset };

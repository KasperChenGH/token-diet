'use strict';
/** history.js — append-only diet-history.json (cross-run memory, F5). */
const fs   = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic');

function historyPath(root) { return path.join(root, 'diet-history.json'); }
function readHistory(root) {
  try { return JSON.parse(fs.readFileSync(historyPath(root), 'utf8')); }
  catch { return { runs: [] }; }
}
function appendRun(root, record) {
  const h = readHistory(root);
  h.runs.push(record);
  writeFileAtomic(historyPath(root), JSON.stringify(h, null, 2));
  return h;
}
// Baseline = the grade at the last optimization/setup, used to detect later structural drift.
function getBaseline(root) { return readHistory(root).baseline || null; }
function setBaseline(root, baseline) {
  const h = readHistory(root);
  h.baseline = baseline;
  writeFileAtomic(historyPath(root), JSON.stringify(h, null, 2));
  return h;
}

function rejectedItemKeys(history) {
  const keys = new Set();
  for (const r of history.runs) for (const k of (r.rejected || [])) keys.add(k);
  return keys;
}
function regrowth(history, file, currentLines) {
  for (let i = history.runs.length - 1; i >= 0; i--) {
    const t = (history.runs[i].trimmed || {})[file];
    if (t != null) return currentLines > t * 1.2;
  }
  return false;
}

module.exports = { historyPath, readHistory, appendRun, rejectedItemKeys, regrowth, getBaseline, setBaseline };

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

module.exports = { applyMove };

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
    '#!/usr/bin/env bash\n# token-diet tool-output filter (PostToolUse) — DISABLED by default.\n' +
    '# Full output -> .claude/toolout/<ts>.log ; emit a compressed view.\n' +
    '# Wire into .claude/settings.json PostToolUse, then smoke-test before enabling.\n',
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

module.exports = { applyMove, applyWrite, applyScaffold };

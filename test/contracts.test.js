'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tokensForFile } = require('../scripts/count-tokens');

const ROOT = path.join(__dirname, '..');

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f));
}

test('every lever rubric is <= 2k tokens (F7)', () => {
  for (const f of listMd(path.join(ROOT, 'references', 'levers'))) {
    assert.ok(tokensForFile(f) <= 2000, `${path.basename(f)} exceeds 2k tokens (${tokensForFile(f)})`);
  }
});

test('all 8 lever rubrics exist', () => {
  const dir = path.join(ROOT, 'references', 'levers');
  for (let i = 1; i <= 8; i++) {
    assert.ok(listMd(dir).some(f => path.basename(f).startsWith(`lever-${i}-`)), `missing lever-${i} rubric`);
  }
});

test('references/subagents knowledge files map to a real agent, stay <= 2k tokens, resolve shared pointers', () => {
  const dir = path.join(ROOT, 'references', 'subagents');
  for (const f of listMd(dir)) {
    const agentPath = path.join(ROOT, 'agents', path.basename(f));
    assert.ok(fs.existsSync(agentPath), `${path.basename(f)} has no matching agents/${path.basename(f)} — orphan private-knowledge file`);
    assert.ok(tokensForFile(f) <= 2000, `${path.basename(f)} exceeds 2k tokens (${tokensForFile(f)})`);
    const c = fs.readFileSync(f, 'utf8');
    for (const m of c.matchAll(/Uses:\s*\[\[shared\/([a-z0-9-]+)\]\]/gi)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'shared', m[1] + '.md')), `${path.basename(f)}: dangling Uses ${m[1]}`);
    }
  }
});

test('agent + subagent files: valid frontmatter and resolvable shared pointers', () => {
  const files = listMd(path.join(ROOT, 'agents'));
  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    assert.ok(c.startsWith('---') && c.indexOf('\n---', 3) > 0, `${path.basename(f)}: bad frontmatter`);
    for (const m of c.matchAll(/Uses:\s*\[\[shared\/([a-z0-9-]+)\]\]/gi)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'shared', m[1] + '.md')), `${path.basename(f)}: dangling Uses ${m[1]}`);
    }
    for (const m of c.matchAll(/Tools:\s*(\S+\.js)/gi)) {
      assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${path.basename(f)}: dangling Tools ${m[1]}`);
    }
  }
});

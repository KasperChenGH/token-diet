'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'token-diet.js');

test('estimate --json runs end-to-end on a fixture', () => {
  const dir  = tmpDir();
  const home = tmpDir();                 // empty home → no global ~/.claude bleeds into the bill
  writeFile(dir, 'CLAUDE.md', 'x'.repeat(400));
  const env  = { ...process.env, HOME: home, USERPROFILE: home }; // os.homedir(): HOME (POSIX) / USERPROFILE (win)
  const out  = execFileSync('node',
    [BIN, 'estimate', '--dir', dir, '--spawns', '5', '--turns', '8', '--toolout', 'med', '--json'],
    { encoding: 'utf8', env });
  const j = JSON.parse(out);
  assert.equal(j.assumptions.spawnsPerRun, 5);
  assert.equal(j.bill.raw.read, 244000);  // 5*(100+6000)*8, deterministic with empty home
  rm(dir); rm(home);
});

test('help lists estimate', () => {
  const out = execFileSync('node', [BIN, '--help'], { encoding: 'utf8' });
  assert.match(out, /estimate/);
});

const fs2 = require('fs');
test('fix applies a write op, then --verify passes', () => {
  const dir = tmpDir();
  const home = tmpDir();
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  writeFile(dir, 'diet-changeset.json', JSON.stringify({ items: [
    { id: 1, op: 'write', to: 'knowledge/d.md', content: 'DIGEST' } ] }));
  const cs = path.join(dir, 'diet-changeset.json');
  execFileSync('node', [BIN, 'fix', '--dir', dir, '--changeset', cs], { encoding: 'utf8', env });
  assert.equal(fs2.readFileSync(path.join(dir, 'knowledge/d.md'), 'utf8'), 'DIGEST');
  execFileSync('node', [BIN, 'fix', '--dir', dir, '--changeset', cs, '--verify'], { encoding: 'utf8', env });
  rm(dir); rm(home);
});

test('fix --verify exits non-zero on a dangling pointer', () => {
  const dir = tmpDir();
  writeFile(dir, '.claude/agents/x.md', '---\nname: x\n---\nUses: [[shared/missing]]');
  writeFile(dir, 'diet-changeset.json', JSON.stringify({ items: [
    { id: 1, op: 'write', to: '.claude/agents/x.md', content: 'x' } ] }));
  const cs = path.join(dir, 'diet-changeset.json');
  assert.throws(() => execFileSync('node', [BIN, 'fix', '--dir', dir, '--changeset', cs, '--verify'], { stdio: 'pipe' }));
  rm(dir);
});

test('audit --json and agents --json run end-to-end on a fixture transcript', () => {
  const home = tmpDir();
  const env  = { ...process.env, HOME: home, USERPROFILE: home };
  const ts   = new Date().toISOString();
  const rec  = JSON.stringify({
    type: 'assistant', requestId: 'req-1', timestamp: ts, sessionId: 's1',
    message: { model: 'claude-opus-4', usage: {
      input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 500, output_tokens: 50 } },
  });
  writeFile(home, '.claude/projects/proj/sess.jsonl', rec + '\n');

  const audit = JSON.parse(execFileSync('node', [BIN, 'audit', '--days', '7', '--json'], { encoding: 'utf8', env }));
  assert.ok(Array.isArray(audit.groups) && audit.groups.length === 1);
  assert.equal(audit.groups[0].output, 50);
  assert.equal(audit.groups[0].calls, 1);

  const agents = JSON.parse(execFileSync('node', [BIN, 'agents', '--days', '7', '--json'], { encoding: 'utf8', env }));
  assert.ok(Array.isArray(agents) && agents.length === 1);
  assert.equal(agents[0].calls, 1);
  rm(home);
});

test('plan emits diet-changeset.json even with no history', () => {
  const dir = tmpDir();
  const home = tmpDir();                          // empty home -> scanAll finds no records
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  writeFile(dir, 'CLAUDE.md', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
  execFileSync('node', [BIN, 'plan', '--dir', dir], { encoding: 'utf8', env });
  const cs = JSON.parse(require('fs').readFileSync(path.join(dir, 'diet-changeset.json'), 'utf8'));
  assert.ok(cs.items.some(i => i.op === 'move'));
  rm(dir); rm(home);
});

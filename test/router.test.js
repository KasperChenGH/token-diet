'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { tmpDir, writeFile, rm } = require('./helpers');
const R = require('../src/router');

const silence = fn => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

test('classifyTask routes clearly mechanical work to haiku', () => {
  for (const t of ['rename a symbol across the repo', 'convert this YAML to JSON', 'sort the imports', 'extract the table to CSV']) {
    const r = R.classifyTask(t);
    assert.equal(r.tier, 'haiku', `"${t}" → ${r.tier}`);
    assert.equal(r.escalate, false);
    assert.equal(r.pin, R.TIER_PIN.haiku);
  }
});

test('classifyTask routes mid-complexity work to sonnet', () => {
  for (const t of ['review this diff against the rubric', 'summarize the PR', 'refactor the parser', 'generate tests for utils']) {
    assert.equal(R.classifyTask(t).tier, 'sonnet', t);
  }
});

test('high-stakes signal ALWAYS pins to opus, even with mechanical keywords present', () => {
  // "extract" is a haiku keyword, but "security" / "architecture" must win (guard rule is first).
  assert.equal(R.classifyTask('extract the security tokens from the architecture doc').tier, 'opus');
  assert.equal(R.classifyTask('rename symbols as part of the production migration').tier, 'opus');
  const r = R.classifyTask('design the strategy');
  assert.equal(r.tier, 'opus');
  assert.equal(r.escalate, true);
});

test('unmatched task defaults to opus and is flagged escalate', () => {
  const r = R.classifyTask('do the thing with the stuff');
  assert.equal(r.tier, 'opus');
  assert.equal(r.matched, false);
  assert.equal(r.escalate, true);
});

test('classifyTask is fail-safe on empty / nullish input (defaults to opus)', () => {
  assert.equal(R.classifyTask('').tier, 'opus');
  assert.equal(R.classifyTask(null).tier, 'opus');
  assert.equal(R.classifyTask(undefined).matched, false);
});

test('first-match-wins ordering: a custom rule table is honored', () => {
  const rules = [
    { tier: 'haiku', label: 'greet', any: ['hello'] },
    { tier: 'sonnet', label: 'all', any: ['.'] },
  ];
  assert.equal(R.classifyTask('hello world', rules).tier, 'haiku'); // first rule wins
  assert.equal(R.classifyTask('zzz', rules).tier, 'sonnet');        // catch-all second
});

test('a malformed regex in a user rule is skipped, never throws (fail-safe)', () => {
  const rules = [
    { tier: 'haiku', label: 'broken', any: ['(unclosed'] },   // invalid regex
    { tier: 'sonnet', label: 'ok', any: ['report'] },
  ];
  assert.doesNotThrow(() => R.classifyTask('write the report', rules));
  assert.equal(R.classifyTask('write the report', rules).tier, 'sonnet'); // broken rule skipped, next matches
  assert.equal(R.classifyTask('nothing here', rules).tier, 'opus');       // unmatched default
});

test('runScaffold writes an editable rule table that loadRules reads back', () => {
  const root = tmpDir();
  // isolate global ~/.claude
  const HOME = tmpDir(); process.env.HOME = HOME; process.env.USERPROFILE = HOME;
  const p = silence(() => R.runScaffold({ dir: root }));
  assert.ok(fs.existsSync(p));
  const loaded = R.loadRules(root);
  assert.ok(Array.isArray(loaded) && loaded.length >= 3);
  assert.equal(loaded[0].tier, 'opus');           // guard rule stays first
  // a project rules.json overrides the defaults
  writeFile(root, '.claude/router/rules.json', JSON.stringify({ rules: [{ tier: 'haiku', label: 'x', any: ['anything'] }] }));
  assert.equal(R.classifyTask('say anything', R.loadRules(root)).tier, 'haiku');
  // re-scaffold must NOT clobber the user's edited table
  silence(() => R.runScaffold({ dir: root }));
  assert.equal(R.loadRules(root)[0].any[0], 'anything');   // still the user's rule
  rm(root); rm(HOME);
});

test('runClassify --json returns the structured decision', () => {
  const root = tmpDir();
  const res = silence(() => R.runClassify({ dir: root, classify: 'convert csv to json', json: true }));
  assert.equal(res.tier, 'haiku');
  rm(root);
});

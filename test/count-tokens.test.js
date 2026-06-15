'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { tmpDir, writeFile, rm } = require('./helpers');
const { tokensForFile, tokensForText } = require('../scripts/count-tokens');

test('tokensForText is bytes/4 rounded', () => {
  assert.equal(tokensForText('x'.repeat(400)), 100);
  assert.equal(tokensForText(''), 0);
  assert.equal(tokensForText(null), 0);
});

test('tokensForFile reads size/4, 0 if missing', () => {
  const dir = tmpDir();
  const f = writeFile(dir, 'a.md', 'y'.repeat(800));
  assert.equal(tokensForFile(f), 200);
  assert.equal(tokensForFile(f + '.nope'), 0);
  rm(dir);
});

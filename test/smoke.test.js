'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { tmpDir, writeFile, rm } = require('./helpers');

test('fixture helper writes and cleans up', () => {
  const dir = tmpDir();
  const f = writeFile(dir, 'CLAUDE.md', 'hello');
  assert.equal(require('fs').readFileSync(f, 'utf8'), 'hello');
  rm(dir);
  assert.equal(require('fs').existsSync(dir), false);
});

'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const D = require('../src/diagnose');

test('resendProjection: multiplier + absolute, never a >100% string', () => {
  const r = D.resendProjection(640000, 100000);
  assert.equal(r.multiplier, 6.4);
  assert.equal(r.absolute, 640000);
  assert.match(r.label, /6\.4× re-send projection/);
  assert.doesNotMatch(r.label, /%/);

  const big = D.resendProjection(1786000, 100000);
  assert.equal(big.multiplier, 17.9);          // was the broken "1786%"
  assert.doesNotMatch(big.label, /%/);
});

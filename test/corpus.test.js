'use strict';
// Signal-preservation corpus: distilled from REAL tool output (see dev_only/corpus.js).
// The filter's core safety contract is "never collapse a failure/error/warning line".
// These fixtures match the actual formats of node:test, pytest, cargo, and npm/eslint;
// the property test asserts every danger line survives compression — and the ✖ case is
// the regression guard for node --test, which token-diet itself runs.
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const F = require('../src/filter');
const cfg = F.DEFAULT_CONFIG;

// Lines that MUST survive compression.
const DANGER = /\b(error|fail(ed|ure)?|assert|exception|traceback|panic)\b|error\[|✗|✘|✖|deprecat|vulnerab|\bwarn(ing)?\b/i;

// Realistic captured-output fixtures (one failure each, lots of passing/progress noise).
const NODE_TEST =
  Array.from({ length: 30 }, (_, i) => `✔ ok${i} (0.${i}ms)`).join('\n') +
  '\n✖ boom (0.86ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  1 !== 2\n' +
  'ℹ tests 31\nℹ pass 30\nℹ fail 1\n✖ failing tests:\n✖ boom (0.86ms)';

const PYTEST =
  'test_x.py ' + '.'.repeat(40) + 'F  [100%]\n' +
  '=================================== FAILURES ===================================\n' +
  '________________________________ test_fail _____________________________________\n' +
  '    def test_fail():\n>       assert 1 == 2, "boom"\nE       AssertionError: boom\nE       assert 1 == 2\n' +
  '=========================== 1 failed, 40 passed in 0.11s =======================';

const CARGO =
  Array.from({ length: 40 }, (_, i) => `   Compiling crate_${i} v1.0.${i}`).join('\n') +
  '\nwarning: unused variable: `x`\n  --> src/main.rs:4:9\n' +
  'error[E0308]: mismatched types\n  --> src/main.rs:10:5\nerror: could not compile `app` due to 1 previous error';

const NPM =
  'npm warn deprecated request@2.88.2: request has been deprecated\n' +
  Array.from({ length: 30 }, () => 'npm http fetch GET 200 https://registry.npmjs.org/x 12ms').join('\n') +
  '\nadded 49 packages in 3s\n3 vulnerabilities (1 moderate, 2 high)';

function survivors(input, fn) {
  const out = fn(input);
  const lost = input.split('\n').map(l => l.trim())
    .filter(l => l && DANGER.test(l) && !out.includes(l));
  return { out, lost };
}

test('signal preservation: node --test failure (✖) is never collapsed [regression]', () => {
  const { out, lost } = survivors(NODE_TEST, t => F.compressTests(t, cfg));
  assert.deepEqual(lost, [], `dropped critical lines: ${lost.join(' | ')}`);
  assert.match(out, /✖ boom/);                 // the failure marker glyph node uses
  assert.match(out, /AssertionError/);
  assert.ok(out.split('\n').length < NODE_TEST.split('\n').length);   // still compresses
});

test('signal preservation: Pester [-] failure (neutral name) survives [regression]', () => {
  // Real Pester 5 format; the failing test name has NO "fail" word, so only the [-] marker saves it.
  const PESTER = Array.from({ length: 30 }, (_, i) => `[+] Math.case ${i} 5ms`).join('\n') +
    '\n[-] Math.computes the total 44ms\n Expected 5, but got 4.\n at It (line 4)\n' +
    'Tests Passed: 30, Failed: 1, Skipped: 0';
  const { out, lost } = survivors(PESTER, t => F.compressTests(t, cfg));
  assert.deepEqual(lost, []);
  assert.match(out, /\[-\] Math\.computes the total/);   // the failing test line
  assert.match(out, /Expected 5, but got 4/);            // its indented assertion detail
  assert.match(out, /Failed: 1/);
});

test('signal preservation: pytest failure block survives', () => {
  const { out, lost } = survivors(PYTEST, t => F.compressTests(t, cfg));
  assert.deepEqual(lost, []);
  assert.match(out, /1 failed, 40 passed/);
  assert.match(out, /AssertionError: boom/);
});

test('signal preservation: dedupLog never elides an error/traceback from the middle [regression]', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `progress line ${i}`);
  lines.splice(30, 0, 'Traceback (most recent call last):', '  File "x.py", line 5', 'FutureWarning: deprecated thing');
  const out = F.dedupLog(lines.join('\n'), cfg);   // default keep=[]
  assert.match(out, /lines elided/);                              // the middle WAS elided
  assert.match(out, /Traceback \(most recent call last\)/);       // …but the traceback survived
  assert.match(out, /FutureWarning/);
});

test('signal preservation: cargo errors + warnings survive build compression', () => {
  const { out, lost } = survivors(CARGO, t => F.compressBuild(t, cfg));
  assert.deepEqual(lost, []);
  assert.match(out, /error\[E0308\]/);
  assert.match(out, /warning: unused/);
  assert.match(out, /progress lines/);              // the Compiling run still collapsed
});

test('signal preservation: npm deprecation + vulnerabilities survive', () => {
  const { out, lost } = survivors(NPM, t => F.compressBuild(t, cfg));
  assert.deepEqual(lost, []);
  assert.match(out, /deprecated request/);
  assert.match(out, /3 vulnerabilities/);
  assert.match(out, /added 49 packages/);
});

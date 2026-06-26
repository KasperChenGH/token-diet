#!/usr/bin/env node
'use strict';
/**
 * seed-report.js — run representative verbose tool output through the REAL Lever 8 filter so the
 * demo can show a populated `filter --report` reduction table. The numbers are genuine compressions
 * of the sample payloads below (not fabricated, and not the README's measured-corpus figures) —
 * it's "watch the filter actually reduce this output", sized for a demo.
 *
 * Usage: node demo/seed-report.js   (writes into demo/sample-project/.claude/toolout/)
 */
const fs     = require('fs');
const path   = require('path');
const filter = require('../src/filter');

const proj = path.join(__dirname, 'sample-project');
const dir  = path.join(proj, '.claude', 'toolout');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'filter.json'),
  JSON.stringify({ enabled: true, mode: 'active', tools: ['Bash'] }, null, 2));

// Representative verbose outputs, each sized above the filter's compress threshold.
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');
const payloads = [
  { command: 'pytest -q',
    response: N(80, i => `tests/test_mod.py::test_${i} PASSED`) +
              '\ntests/test_mod.py::test_42 FAILED\n  assert result == expected\nE  AssertionError\n=== 1 failed, 80 passed in 3.1s ===' },
  { command: 'git diff',
    response: 'diff --git a/src/app.py b/src/app.py\nindex 1a2b3c4..5d6e7f8 100644\n--- a/src/app.py\n+++ b/src/app.py\n@@ -1,80 +1,80 @@\n' +
              N(80, i => (i % 2 ? `+    refactored_line_${i} = compute(${i})` : `-    legacy_line_${i} = old_compute(${i})`)) +
              '\n 3 files changed, 80 insertions(+), 80 deletions(-)' },
  { command: 'npm run build',
    response: N(90, i => `   Compiling crate_${i} v1.0.${i}`) +
              '\nwarning: unused variable: `x`\nerror[E0308]: mismatched types\n   Finished release [optimized] in 12.4s' },
  { command: 'curl https://api.example.com/items',
    response: JSON.stringify({ status: 'ok', count: 200,
      items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: 'item ' + i, note: 'x'.repeat(60) })) }) },
  { command: 'docker compose logs',
    response: N(120, () => 'service-1  | connecting to upstream...') + '\nservice-1  | ready\nservice-1  | listening on :8080' },
];

let n = 0;
for (const p of payloads) {
  filter.compressPayload(
    { tool_name: 'Bash', tool_input: { command: p.command }, tool_response: p.response },
    proj, `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`);
  n++;
}
console.log(`Seeded ${n} filtered calls → ${path.join(dir, 'stats.jsonl')}`);

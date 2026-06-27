'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const T = require('../src/trace');

// hand-built event helper: {recIdx, tool, sig, resultTokens, isError, cacheRead}
const ev = (recIdx, sig, resultTokens = 0, isError = false, tool = 'Read') => ({ recIdx, tool, sig, resultTokens, isError, cacheRead: 0 });

test('argSignature is fuzzy: whitespace/digits collapse, different files differ', () => {
  const a = T.argSignature('Bash', { command: 'npm test' });
  const b = T.argSignature('Bash', { command: 'npm   test' });      // extra whitespace
  assert.equal(a, b);                                                // fuzzy: whitespace collapses
  // fuzzy: standalone digits collapse, so the same command with a changing number matches
  assert.equal(T.argSignature('Bash', { command: 'retry attempt 5' }),
               T.argSignature('Bash', { command: 'retry attempt 9' }));
  assert.notEqual(a, T.argSignature('Bash', { command: 'npm build' }));
  assert.notEqual(T.argSignature('Read', { file_path: 'a.js' }), T.argSignature('Read', { file_path: 'b.js' }));
  assert.equal(T.argSignature('Read', { file_path: 'a.js', offset: 1 }), T.argSignature('Read', { file_path: 'a.js', offset: 99 })); // same file, any range
});

test('detectLoops flags ≥3 consecutive same-sig calls with near-identical results', () => {
  const events = [ev(0, 'Read:foo', 100), ev(1, 'Read:foo', 100), ev(2, 'Read:foo', 100), ev(3, 'Bash:done', 5)];
  const loops = T.detectLoops(events);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].count, 3);
  assert.deepEqual([loops[0].start, loops[0].end], [0, 2]);
});

test('detectLoops does NOT flag when results change (genuine progress, not a loop)', () => {
  const events = [ev(0, 'Bash:next', 100), ev(1, 'Bash:next', 800), ev(2, 'Bash:next', 4000)]; // growing results
  assert.equal(T.detectLoops(events).length, 0);
  // two identical is below the threshold
  assert.equal(T.detectLoops([ev(0, 'Read:foo', 100), ev(1, 'Read:foo', 100)]).length, 0);
});

test('detectLoops excludes mutating tools (10 Edits to a file is progress, not a loop)', () => {
  const edits = Array.from({ length: 10 }, (_, k) => ev(k, 'Edit:app.js', 30, false, 'Edit'));
  assert.equal(T.detectLoops(edits).length, 0);                    // Edit run is NOT a loop
  // but a Read run of the same length still is
  const reads = Array.from({ length: 10 }, (_, k) => ev(k, 'Read:app.js', 100, false, 'Read'));
  assert.equal(T.detectLoops(reads).length, 1);
});

test('detectRetries flags ≥2 consecutive error results', () => {
  const events = [ev(0, 'Bash:t', 50, false), ev(1, 'Bash:t', 50, true), ev(2, 'Bash:t', 50, true), ev(3, 'Bash:ok', 10, false)];
  const streaks = T.detectRetries(events);
  assert.equal(streaks.length, 1);
  assert.equal(streaks[0].count, 2);
});

test('detectCompactions flags a sharp cache_read drop', () => {
  const recs = [{ cacheRead: 10000 }, { cacheRead: 10500 }, { cacheRead: 3000 }, { cacheRead: 3200 }];
  assert.deepEqual(T.detectCompactions(recs), [2]);           // drop >40% at index 2
  assert.deepEqual(T.detectCompactions([{ cacheRead: 1000 }, { cacheRead: 100 }]), []); // below the floor → ignored
});

test('resendTurns counts later calls until the next compaction (else session end)', () => {
  assert.equal(T.resendTurns(1, 5, []), 3);      // calls 2,3,4 re-send it
  assert.equal(T.resendTurns(1, 5, [3]), 1);     // compaction at 3 → only call 2 re-sends it
});

test('detectDelegation flags an EXPLORATION CLUSTER in MAIN, not a single needed read', () => {
  const recs = Array.from({ length: 6 }, () => ({ cacheRead: 9000 }));
  // a single verbose read (you needed that file) is NOT under-delegation
  const single = [{ recIdx: 0, tool: 'Read', resultTokens: 9000, isError: false },
                  { recIdx: 1, tool: 'Edit', resultTokens: 30, isError: false }];
  assert.equal(T.detectDelegation(single, recs, 'session').under.length, 0);
  // a cluster of ≥3 consecutive retrieval calls dumping >4k tokens IS flagged
  const cluster = [
    { recIdx: 0, tool: 'Grep', resultTokens: 3000, isError: false },
    { recIdx: 1, tool: 'Read', resultTokens: 3000, isError: false },
    { recIdx: 2, tool: 'Read', resultTokens: 3000, isError: false },
    { recIdx: 3, tool: 'Edit', resultTokens: 30, isError: false },     // breaks the run
  ];
  const d = T.detectDelegation(cluster, recs, 'session');
  assert.equal(d.under.length, 1);
  assert.equal(d.under[0].count, 3);
  assert.equal(d.under[0].tokens, 9000);
  assert.equal(d.under[0].saved, Math.round(9000 * 0.85));   // direct reduction (no resend multiplier in the headline)
});

test('detectDelegation flags a tiny subagent as over-delegation (Lever 1)', () => {
  const events = [{ recIdx: 0, tool: 'Read', resultTokens: 200, isError: false }];
  const d = T.detectDelegation(events, [{ cacheRead: 0 }], 'subagent');
  assert.equal(d.over.length, 1);
  assert.equal(d.over[0].calls, 1);
  assert.equal(d.overTax, 20000);
  // a substantial subagent is NOT flagged
  const big = Array.from({ length: 10 }, (_, k) => ({ recIdx: k, tool: 'Read', resultTokens: 3000, isError: false }));
  assert.equal(T.detectDelegation(big, big.map(() => ({ cacheRead: 0 })), 'subagent').over.length, 0);
});

test('detectContextPressure flags a session that held a near-full context most of the run', () => {
  const heavy = Array.from({ length: 10 }, () => ({ cacheRead: 150000 }));
  assert.equal(T.detectContextPressure(heavy).heavy, true);
  const light = Array.from({ length: 10 }, () => ({ cacheRead: 5000 }));
  assert.equal(T.detectContextPressure(light).heavy, false);
});

// integration: records + scan-style meta → analyzeSession with compounding waste math
test('analyzeSession measures a Read loop with compounding (resend) waste', () => {
  const mk = (id, fp) => ({ toolCalls: [{ name: 'Read', id, filePath: fp }], input: 0, cacheWrite: 0, cacheRead: 10000, output: 0 });
  const records = [mk('a', 'foo.js'), mk('b', 'foo.js'), mk('c', 'foo.js'), mk('d', 'foo.js'),
                   { toolCalls: [{ name: 'Bash', id: 'e' }], input: 0, cacheWrite: 0, cacheRead: 10000, output: 0 }];
  const meta = {
    toolCallsById: new Map([
      ['a', { name: 'Read', input: { file_path: 'foo.js' } }], ['b', { name: 'Read', input: { file_path: 'foo.js' } }],
      ['c', { name: 'Read', input: { file_path: 'foo.js' } }], ['d', { name: 'Read', input: { file_path: 'foo.js' } }],
      ['e', { name: 'Bash', input: { command: 'done' } }],
    ]),
    toolResults: ['a', 'b', 'c', 'd'].map(id => ({ tool_use_id: id, result_tokens: 100, is_error: false }))
      .concat([{ tool_use_id: 'e', result_tokens: 5, is_error: false }]),
  };
  const r = T.analyzeSession(records, meta);
  // loop = 4 Reads of foo.js; reps 2..4 are waste → introduced 100×3 = 300
  assert.equal(r.wasteRaw, 300);
  // compounding: event recIdx 1→resend4, 2→resend3, 3→resend2  ⇒ 400+300+200 = 900
  assert.equal(r.wasteEffective, 900);
  assert.equal(r.sessionTotal, 50000);            // 5 × 10000 cache_read
  assert.ok(Math.abs(r.wasteRatio - 0.018) < 1e-9);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'loop');
  assert.equal(r.items[0].count, 4);
});

'use strict';
/**
 * estimate.js — no-history forward token projection.
 * Reuses src/collectors.js. Constants below are MAINTAINER-ONLY (never user flags).
 */
const C = require('./collectors');

// ── maintainer-only modeling constants (tune here as real audit data accrues) ──
const TOOLOUT         = { low: 1500, med: 6000, high: 18000 }; // tokens retained per agent
const OUTPUT_PER_TURN = 350;                                   // modeled narrative tokens/turn
const PRICE           = { write: 1.25, read: 0.1, output: 1.0 }; // relative $ weights
// ───────────────────────────────────────────────────────────────────────────────

function deriveSpawns(cmdFiles) {
  let max = 0;
  for (const { content } of cmdFiles) {
    if (!content) continue;
    for (const m of content.matchAll(/\b(\d+)\s+(?:sub)?agents?\b/gi)) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
    const sig = (content.match(new RegExp(C.SPAWN_RE.source, 'gi')) || []).length;
    if (sig > max) max = Math.min(sig, 10);
  }
  return max > 0 ? max : 5;
}
function deriveTurns(cmdFiles) {
  let max = 0;
  for (const { content } of cmdFiles) {
    if (!content) continue;
    const n = (content.match(new RegExp(C.STEP_RE.source, 'gim')) || []).length;
    if (n > max) max = n;
  }
  return max > 0 ? max : 8;
}
function deriveToolout(cmdFiles) {
  let hits = 0;
  for (const { content } of cmdFiles) {
    if (!content) continue;
    hits += (content.match(new RegExp(C.COMPUTE_RE.source, 'gi')) || []).length;
  }
  if (hits >= 4) return 'high';
  if (hits >= 1) return 'med';
  return 'low';
}

function deriveInputs(targetDir, home, opts = {}) {
  const oh  = C.collectOverhead(targetDir, home);
  const cmd = C.collectCommandFiles(targetDir, home);
  const spawnsPerRun     = opts.spawns  != null ? opts.spawns  : deriveSpawns(cmd);
  const turnsPerAgent    = opts.turns   != null ? opts.turns   : deriveTurns(cmd);
  const toolOutputWeight = opts.toolout != null ? opts.toolout : deriveToolout(cmd);
  return {
    perSpawnOverhead:   oh.perSpawnTotal,
    perSessionOverhead: oh.perSessionTotal,
    spawnsPerRun, turnsPerAgent, toolOutputWeight,
    toolOutputTokens:   TOOLOUT[toolOutputWeight],
    evidence: {
      spawns:  opts.spawns  != null ? 'flag --spawns'  : 'max fan-out in command files',
      turns:   opts.turns   != null ? 'flag --turns'   : 'numbered Step headers',
      toolout: opts.toolout != null ? 'flag --toolout' : 'compute/test/build/log signals',
    },
  };
}

function computeBill(inp) {
  const write  = inp.spawnsPerRun * inp.perSpawnOverhead + inp.perSessionOverhead;
  const read   = inp.spawnsPerRun * (inp.perSpawnOverhead + inp.toolOutputTokens) * inp.turnsPerAgent;
  const output = inp.spawnsPerRun * inp.turnsPerAgent * OUTPUT_PER_TURN;
  return { write, read, output, total: write + read + output };
}
function weight(bill) {
  const write  = bill.write  * PRICE.write;
  const read   = bill.read   * PRICE.read;
  const output = bill.output * PRICE.output;
  return { write, read, output, total: write + read + output };
}

// Each lever returns a NEW inputs object with its adjustment applied.
const LEVER_FIX = {
  1: (inp) => ({ ...inp, spawnsPerRun: Math.max(1, inp.spawnsPerRun - 1) }),
  4: (inp) => ({ ...inp, _outputFactor: 0.5 }),
  5: (inp, o) => ({ ...inp, perSpawnOverhead: Math.round(inp.perSpawnOverhead * (o.tierTrim ?? 0.7)) }),
  6: (inp, o) => ({ ...inp, perSpawnOverhead: Math.round(inp.perSpawnOverhead * (o.perSpawnTrim ?? 0.4)) }),
  8: (inp) => ({ ...inp, toolOutputTokens: TOOLOUT.low, toolOutputWeight: 'low' }),
};
// Fixed order so overlapping levers (5,6 both touch perSpawnOverhead) don't double-count.
const FIX_ORDER = [1, 6, 5, 4, 8];

function applyFixes(inp, levers, opts = {}) {
  let cur = { ...inp };
  for (const lever of FIX_ORDER) {
    if (levers.includes(lever) && LEVER_FIX[lever]) cur = LEVER_FIX[lever](cur, opts);
  }
  return cur;
}

// computeBill honoring an optional _outputFactor (L4)
function billOf(inp) {
  const b = computeBill(inp);
  if (inp._outputFactor != null) {
    b.output = Math.round(b.output * inp._outputFactor);
    b.total  = b.write + b.read + b.output;
  }
  return b;
}

function savings(inp, levers, opts = {}) {
  const baseline         = billOf(inp);
  const baselineWeighted = weight(baseline);
  const fixedAll         = billOf(applyFixes(inp, levers, opts));
  const postfixWeighted  = weight(fixedAll);

  const savers = levers.map(lever => {
    const one = billOf(applyFixes(inp, [lever], opts));
    const w   = weight(one);
    return {
      lever,
      rawSaved:      baseline.total - one.total,
      weightedSaved: Math.round(baselineWeighted.total - w.total),
    };
  }).sort((a, b) => b.weightedSaved - a.weightedSaved);

  return {
    baseline, baselineWeighted, postfix: fixedAll, postfixWeighted, savers,
    note: 'Per-lever savings are marginal attribution; the "if all fixed" total is recomputed once, not summed.',
  };
}

module.exports = { TOOLOUT, OUTPUT_PER_TURN, PRICE,
  deriveInputs, computeBill, weight, applyFixes, savings };

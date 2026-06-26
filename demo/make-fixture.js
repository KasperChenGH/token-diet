#!/usr/bin/env node
'use strict';
/**
 * make-fixture.js — generate a deliberately token-WASTEFUL sample project so the demo shows a
 * bad grade + real findings. (token-diet's own repo grades A, which makes for a dull demo.)
 *
 * Usage:  node demo/make-fixture.js [outDir=demo/sample-project]
 * Zero-dep. Idempotent (wipes + regenerates outDir). The generated sample-project/ is gitignored.
 */
const fs   = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || path.join(__dirname, 'sample-project'));
fs.rmSync(out, { recursive: true, force: true });
const w = (rel, content) => {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

// ── Lever 6: a bloated always-loaded CLAUDE.md (300 lines → high-severity) ──
const claude = [
  '# Project Instructions',
  '',
  '## Overview',
  ...Array.from({ length: 60 }, (_, i) => `This project does important thing number ${i}. ` +
    'Here is a long-winded paragraph of background that every agent reloads on every single run.'),
  '',
  '## Active Scripts',
  ...Array.from({ length: 40 }, (_, i) => `- scripts/job_${i}.py — runs job ${i} (full description inline)`),
  '',
  '## Definitions',
  ...Array.from({ length: 60 }, (_, i) => `- term_${i}: a definition that belongs in a reference file, not here.`),
  '',
  '## Style guide',
  ...Array.from({ length: 60 }, (_, i) => `Rule ${i}: always do the verbose thing and never summarize.`),
].join('\n');
w('CLAUDE.md', claude);

// ── Lever 1 + 4: a command that spawns many agents and does arithmetic in prose ──
w('.claude/commands/research-loop.md', [
  '---', 'description: run the research loop', '---',
  '# Research loop',
  '',
  'Spawn 8 subagents to explore ideas in parallel.',
  'Then calculate the average score across all candidates, rank them by Sharpe ratio,',
  'compute the standard deviation, and sum the totals to pick the winner.',
  '',
  '## Step 1', 'Gather data.',
  '## Step 2', 'Summarize.',
].join('\n'));

// ── Lever 7 + 8: mechanical reviewer, no model pin, mentions tests/builds, no hook ──
w('.claude/commands/precheck.md', [
  '---', 'description: pre-commit review', '---',
  '# Precheck',
  '',
  'Apply the fixed rubric to each changed file: pass/fail against defined criteria. Extraction only.',
  'Run the test suite and the build, then read the full log output to confirm everything passed.',
].join('\n'));

// ── Lever 1: a ceremonial agent with no parallelism/isolation justification ──
w('.claude/agents/reviewer.md', [
  '---', 'name: reviewer', '---',
  'You are a reviewer. Read the file and report issues.',
].join('\n'));

// ── Lever 5: a big reference dir re-read every run, no digest/index ──
for (const name of ['api-reference', 'runbook', 'domain-glossary', 'style-bible']) {
  w(`knowledge/${name}.md`, '# ' + name + '\n' +
    Array.from({ length: 220 }, (_, i) => `Section ${i}: detailed reference material an agent re-reads every run.`).join('\n'));
}

console.log('Wasteful fixture written to: ' + out);

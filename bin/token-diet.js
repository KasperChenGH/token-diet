#!/usr/bin/env node
'use strict';
/**
 * token-diet — zero-dependency CLI for measuring, planning, and verifying
 *              token-usage reduction in agentic workflows
 *
 * Usage:
 *   token-diet audit     [--days N=2] [--project <slug>] [--json]
 *   token-diet agents    [--days N=2] [--project <slug>] [--json]
 *   token-diet diagnose  [--days N=2] [--project <slug>] [--json]
 *   token-diet overhead  [--dir <path>=cwd] [--json]
 *   token-diet plan      [--days N=7] [--project <slug>] [--out diet-plan.md]
 *   token-diet compare   --before-days A --after-days B [--project <slug>] [--json]
 *   token-diet init      [--global]
 *
 * Data source: ~/.claude/projects/<project-slug>/*.jsonl
 *              (agent-*.jsonl files are classified as "subagent" sessions)
 *
 * See skills/SKILL.md for the full reference guide and optimization levers.
 */

const { runAudit }    = require('../src/audit');
const { runAgents }   = require('../src/agents');
const { runDiagnose } = require('../src/diagnose');
const { runOverhead } = require('../src/overhead');
const { runPlan }     = require('../src/plan');
const { runCompare }  = require('../src/compare');
const { runInit }     = require('../src/init');
const { runReview }   = require('../src/review');
const { runEstimate } = require('../src/estimate');
const { runFix, runVerify } = require('../src/fix');

// ── arg parser ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args  = argv.slice(2);
  const opts  = {
    days:       null,   // null = use subcommand default
    project:    null,
    json:       false,
    dir:        null,
    out:        null,
    beforeDays: null,
    afterDays:  null,
    global:     false,
    spawns:     null,
    turns:      null,
    toolout:    null,
    changeset:  null,
    only:       null,
    dryRun:     false,
    verify:     false,
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--days' || a === '-d') {
      opts.days = parseInt(args[++i], 10);
    } else if (a.startsWith('--days=')) {
      opts.days = parseInt(a.split('=')[1], 10);
    } else if (a === '--project' || a === '-p') {
      opts.project = args[++i];
    } else if (a.startsWith('--project=')) {
      opts.project = a.split('=')[1];
    } else if (a === '--dir') {
      opts.dir = args[++i];
    } else if (a.startsWith('--dir=')) {
      opts.dir = a.split('=')[1];
    } else if (a === '--out') {
      opts.out = args[++i];
    } else if (a.startsWith('--out=')) {
      opts.out = a.split('=')[1];
    } else if (a === '--before-days') {
      opts.beforeDays = parseInt(args[++i], 10);
    } else if (a.startsWith('--before-days=')) {
      opts.beforeDays = parseInt(a.split('=')[1], 10);
    } else if (a === '--after-days') {
      opts.afterDays = parseInt(args[++i], 10);
    } else if (a.startsWith('--after-days=')) {
      opts.afterDays = parseInt(a.split('=')[1], 10);
    } else if (a === '--spawns') {
      opts.spawns = parseInt(args[++i], 10);
    } else if (a.startsWith('--spawns=')) {
      opts.spawns = parseInt(a.split('=')[1], 10);
    } else if (a === '--turns') {
      opts.turns = parseInt(args[++i], 10);
    } else if (a.startsWith('--turns=')) {
      opts.turns = parseInt(a.split('=')[1], 10);
    } else if (a === '--toolout') {
      opts.toolout = args[++i];
    } else if (a.startsWith('--toolout=')) {
      opts.toolout = a.split('=')[1];
    } else if (a === '--changeset') {
      opts.changeset = args[++i];
    } else if (a.startsWith('--changeset=')) {
      opts.changeset = a.split('=')[1];
    } else if (a === '--only') {
      opts.only = args[++i];
    } else if (a.startsWith('--only=')) {
      opts.only = a.split('=')[1];
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--verify') {
      opts.verify = true;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--global') {
      opts.global = true;
    } else if (!a.startsWith('-')) {
      positional.push(a);
    }
  }

  return { subcommand: positional[0], opts };
}

function showHelp() {
  console.log(`
token-diet — Static project review + Measure, plan, and verify token-usage reduction for agentic workflows
  (zero dependencies, reads ~/.claude/projects/**/*.jsonl)

REVIEW (static, no history)
  review      Score a project's Claude Code design artifacts against all 8 levers.
              Reads CLAUDE.md, commands, agents, skills, settings, knowledge/ dirs.
              Emits per-lever scorecard + findings + overall grade (A-F).
              No transcript history needed — run before your first session.
  estimate    Forward token projection (no history): per-run bill (write/read/output,
              raw + price-weighted), post-fix re-projection, per-lever savings ranking.
              Inputs derived from structure; override with --spawns/--turns/--toolout.

MEASURE
  audit       Token breakdown by session-kind × model-family + top sessions
  agents      Per-file efficiency: ratio = output / (output + fresh_in + cache_write)
              Files with ratio < 0.15 are flagged "READING NOT THINKING"

DIAGNOSE
  diagnose    Six waste heuristics with lever labels and addressable share estimates
  overhead    Static always-loaded burden: CLAUDE.md, commands, skills (Lever 6)
              Shows "cost per round if N agents spawned" for N=1/5/10

ACT
  plan        Turn diagnosis into an actionable ordered plan (markdown checklist)
              Ordered by lever priority with evidence + rough savings per item
  fix         Apply an approved diet-changeset.json (move/write/scaffold/comment-marker).
              --changeset <file> --only 1,3 --dry-run   |   --verify checks edited files
  init        Install token-diet as a Claude Code skill + agent + command + lever rubrics
              Default: <cwd>/.claude/  |  --global: ~/.claude/

VERIFY
  compare     Before vs after: per-day averages, delta %, verdict line
              Requires --before-days A --after-days B

OPTIONS
  --days N          Only include lines timestamped in the last N days (default varies by subcommand)
  --project <s>     Filter to project dirs whose name contains <s> (substring match)
  --json            Emit JSON instead of human-readable tables
  --dir <path>      Directory to scan for overhead/review/estimate (default: cwd)
  --spawns N        estimate: assumed subagent spawns per run (default: derived)
  --turns N         estimate: assumed turns per agent (default: derived)
  --toolout W       estimate: tool-output weight low|med|high (default: derived)
  --out <file>      Output file for plan (default: diet-plan.md)
  --before-days A   Compare: start of "before" window (days ago)
  --after-days B    Compare: boundary between before/after (days ago); "after" = last B days
  --global          init: install to ~/.claude/skills/ instead of project .claude/skills/
  --help            Show this help

NOTE: Usage is deduplicated per API request (keyed on requestId). Claude Code
  emits 2-3 assistant lines per API call sharing identical usage — counting
  each line would inflate all token totals 2-3x. Calls = distinct API requests.

FORMULAS
  useful-work ratio  = output / (output + fresh_in + cache_write)
  avg context/call   = cache_read / calls
  est tokens in file = file_size_bytes / 4

SESSION KINDS
  session   — main session file (uuid.jsonl)
  subagent  — spawned sub-session (agent-*.jsonl)

MODEL FAMILIES
  opus | sonnet | haiku | other

See skills/SKILL.md for the full optimization guide and levers.
`);
}

// ── dispatch ──────────────────────────────────────────────────────────────────
async function main() {
  const { subcommand, opts } = parseArgs(process.argv);

  if (!subcommand || subcommand === '--help' || subcommand === 'help') {
    showHelp();
    return;
  }

  switch (subcommand) {
    case 'audit':
      await runAudit(opts);
      break;
    case 'agents':
      await runAgents(opts);
      break;
    case 'diagnose':
      await runDiagnose(opts);
      break;
    case 'overhead':
      await runOverhead(opts);
      break;
    case 'plan':
      if (opts.days == null) opts.days = 7;
      await runPlan(opts);
      break;
    case 'compare':
      await runCompare(opts);
      break;
    case 'init':
      await runInit(opts);
      break;
    case 'review':
      await runReview(opts);
      break;
    case 'estimate':
      await runEstimate(opts);
      break;
    case 'fix':
      if (opts.verify) {
        const problems = runVerify(opts);
        if (problems.length) process.exit(1);
      } else {
        await runFix(opts);
      }
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      showHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

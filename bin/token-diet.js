#!/usr/bin/env node
'use strict';
/**
 * token-diet — zero-dependency Claude Code token usage auditor
 *
 * Usage:
 *   token-diet audit     [--days N=2] [--project <slug>] [--json]
 *   token-diet agents    [--days N=2] [--project <slug>] [--json]
 *   token-diet diagnose  [--days N=2] [--project <slug>] [--json]
 *
 * Data source: ~/.claude/projects/<project-slug>/*.jsonl
 *              (agent-*.jsonl files are classified as "subagent" sessions)
 *
 * See SKILL.md for the full reference guide and optimization levers.
 */

const { runAudit }    = require('../src/audit');
const { runAgents }   = require('../src/agents');
const { runDiagnose } = require('../src/diagnose');

// ── arg parser ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args  = argv.slice(2);
  const opts  = { days: 2, project: null, json: false };
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
    } else if (a === '--json') {
      opts.json = true;
    } else if (!a.startsWith('-')) {
      positional.push(a);
    }
  }

  return { subcommand: positional[0], opts };
}

function showHelp() {
  console.log(`
token-diet — Claude Code token usage auditor
  (zero dependencies, reads ~/.claude/projects/**/*.jsonl)

SUBCOMMANDS
  audit     Token breakdown by session-kind × model-family + top sessions
  agents    Per-file efficiency: ratio = output / (output + fresh_in + cache_write)
            Files with ratio < 0.15 are flagged "READING NOT THINKING"
  diagnose  Six waste heuristics with lever labels and addressable share estimates

OPTIONS
  --days N        Only include lines timestamped in the last N days (default: 2)
  --project <s>   Filter to project dirs whose name contains <s> (substring match)
  --json          Emit JSON instead of human-readable tables
  --help          Show this help

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
  fable | opus | sonnet | haiku | other

See SKILL.md for the full optimization guide and levers.
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

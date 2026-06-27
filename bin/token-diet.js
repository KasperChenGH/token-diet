#!/usr/bin/env node
'use strict';
/**
 * token-diet — zero-dependency CLI for measuring, planning, and verifying
 *              token-usage reduction in agentic workflows
 *
 * Usage:
 *   token-diet review    [--dir <path>=cwd] [--json]
 *   token-diet estimate  [--dir <path>=cwd] [--spawns N] [--turns N] [--toolout W] [--json]
 *   token-diet audit     [--days N=2] [--project <slug>] [--json]
 *   token-diet agents    [--days N=2] [--project <slug>] [--json]
 *   token-diet diagnose  [--days N=2] [--project <slug>] [--json]
 *   token-diet overhead  [--dir <path>=cwd] [--json]
 *   token-diet plan      [--days N=7] [--project <slug>] [--out diet-plan.md]
 *   token-diet fix       --changeset <file> [--only 1,3] [--dry-run | --verify]
 *   token-diet filter    --install | --self-test | --enable | --disable | --uninstall
 *   token-diet readgate  --install | --self-test | --enable | --activate | --disable | --report | --uninstall
 *   token-diet route     --classify "<task>" | --scaffold | --self-test [--json]
 *   token-diet compare   --before-days A --after-days B [--project <slug>] [--json]
 *   token-diet burn      [--days N=2] [--project <slug>] [--json]
 *   token-diet digest    [--days N=7] [--project <slug>] [--min-reads N=3] [--scaffold] [--dir <path>]
 *   token-diet savings   [--dir <path>=cwd] [--share] [--dry-run] [--json]
 *   token-diet init      [--global] [--dir <path>]
 *   token-diet setup     wire the filter (audit) + a pre-commit drift gate in one command
 *
 * Data source: ~/.claude/projects/<project-slug>/*.jsonl
 *              (agent-*.jsonl files are classified as "subagent" sessions)
 *
 * See skills/SKILL.md for the full reference guide and optimization levers.
 */

// Subcommand modules are require()d LAZILY inside each switch case (below), not eagerly
// here. This matters for the hot path: the Lever 8 filter runs as a PostToolUse hook
// (`token-diet filter`) on every Bash/PowerShell call — a fresh Node process each time.
// Loading only src/filter.js (+ its tiny deps) instead of all ~13 subcommand modules and
// their transitive graph (scan, review, estimate, diagnose, plan, compare, …) trims the
// per-call startup cost. Each case below pulls in exactly what it needs.

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
    selfTest:   false,
    install:    false,
    uninstall:  false,
    enable:     false,
    activate:   false,
    disable:    false,
    report:     false,
    failUnder:  null,
    scaffold:   false,
    classify:   null,
    minReads:   null,
    share:      false,
    record:     false,
    help:       false,
    _unknown:   [],
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
    } else if (a === '--self-test') {
      opts.selfTest = true;
    } else if (a === '--install') {
      opts.install = true;
    } else if (a === '--uninstall') {
      opts.uninstall = true;
    } else if (a === '--enable') {
      opts.enable = true;
    } else if (a === '--activate') {
      opts.activate = true;
    } else if (a === '--disable') {
      opts.disable = true;
    } else if (a === '--report') {
      opts.report = true;
    } else if (a === '--scaffold') {
      opts.scaffold = true;
    } else if (a === '--classify') {
      opts.classify = args[++i];
    } else if (a.startsWith('--classify=')) {
      opts.classify = a.split('=').slice(1).join('=');
    } else if (a === '--share') {
      opts.share = true;
    } else if (a === '--record') {
      opts.record = true;
    } else if (a === '--min-reads') {
      opts.minReads = parseInt(args[++i], 10);
    } else if (a.startsWith('--min-reads=')) {
      opts.minReads = parseInt(a.split('=')[1], 10);
    } else if (a === '--fail-under') {
      opts.failUnder = args[++i];
    } else if (a.startsWith('--fail-under=')) {
      opts.failUnder = a.split('=')[1];
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--global') {
      opts.global = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (!a.startsWith('-')) {
      positional.push(a);
    } else {
      opts._unknown.push(a);   // unrecognized flag — surface a typo instead of ignoring it
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
              --fail-under <grade> exits non-zero on regression (CI / pre-commit gate)
              --record stamps the current grade as the drift baseline; a later plain
              review nudges if the structure regressed (the pre-commit gate uses this)
  estimate    Forward token projection (a MODEL, not a measurement): per-run bill
              (write/read/output, raw + price-weighted), post-fix re-projection, per-lever
              savings ranking. Inputs derived from structure; override --spawns/--turns/--toolout.

MEASURE
  audit       Token breakdown by session-kind × model-family + top sessions
  agents      Per-file efficiency: ratio = output / (output + fresh_in + cache_write)
              Files with ratio < 0.15 are flagged "READING NOT THINKING"

DIAGNOSE
  trace       BEHAVIORAL waste from real transcripts (Lever 3): action loops + retry streaks,
              measured and compounded through cache_read until the next compaction boundary.
              The dynamic counterpart to the static review. --days N --project s [--json]
  diagnose    Six waste heuristics with lever labels and addressable share estimates
  overhead    [DEPRECATED — folded into review] Static always-loaded burden (Lever 6).
              Prints a deprecation notice; use 'token-diet review' for the overhead snapshot.

ACT
  plan        Turn diagnosis into an actionable ordered plan (markdown checklist)
              Ordered by lever priority with evidence + rough savings per item
  fix         Apply an approved diet-changeset.json (move/write/scaffold/comment-marker).
              --changeset <file> --only 1,3 --dry-run   |   --verify checks edited files
  filter      Lever 8 output-compression engine (PostToolUse hook). Compresses verbose tool
              output before it re-enters context; full output saved to .claude/toolout/.
              Off by default. Flow: --install [--global] → --self-test → --enable (AUDIT: records
              what it'd save, no changes) → --report → --activate (go live). Also --disable / --uninstall.
              --report [--json] shows the measured reduction table. Tune tools/keep/thresholds in filter.json.
  readgate    Lever 3 read-path dedup (PreToolUse hook). Detects within-session re-reads of an
              UNCHANGED file and (active) denies them with a recoverable reason; full file stays on
              disk. Off by default. Flow: --install [--global] → --self-test → --enable (AUDIT:
              records what it'd save, denies nothing) → --report → --activate (go live). Also
              --disable / --uninstall. Tune minTokens/ttlMinutes in .claude/readgate/config.json.
  route       Lever 7 model-arbitrage router: classify a task description into a model
              tier (haiku|sonnet|opus) via a deterministic, editable rule table. Routes DOWN
              only when confident; high-stakes/ambiguous work always pins to opus (escalate).
              --classify "<task>" decides one task; --scaffold writes .claude/router/rules.json;
              --self-test runs fixtures. Measure the real split with 'token-diet agents'.
  digest      Lever 5 read-digest prototype: find files an agent re-reads from your
              transcripts, measure the re-read token cost, and (--scaffold) write a
              deterministic structure skeleton per file under .claude/digests/ for an
              agent to turn into a tight summary. --min-reads N (default 3), --days N.
  init        Install token-diet as a Claude Code skill + agent + command + lever rubrics
              Default (project): <cwd>/.claude/ — also VENDORS the zero-dep CLI into
              .claude/token-diet/ so the project runs with NO global install (any project type).
              --global: ~/.claude/ (no vendoring; relies on the global token-diet binary)
  setup       Wire ongoing protection in one shot: output filter (AUDIT mode — records only,
              no changes) + a pre-commit drift reminder. Then 'filter --activate' when ready —
              or 'setup --activate' to wire AND go live immediately (skip the audit preview).

VERIFY
  compare     Before vs after: per-day averages, delta %, verdict line
              Requires --before-days A --after-days B
  burn        Billing-window view: bucket recent activity into 5-hour blocks (the
              usage-limit reset unit), raw + price-weighted tokens per block, plus a
              projection of the current block to its reset. Reconcilable with ccusage.
  savings     Per-lever / per-section token-reduction table (structural levers PROJECTED
              from estimate; output filter MEASURED from real stats). --share builds an
              aggregate-only report + a pre-filled GitHub issue link (opt-in; --dry-run to
              preview the exact payload). Nothing is sent unless you run --share.

OPTIONS
  --days N          Only include lines timestamped in the last N days (default varies by subcommand)
  --project <s>     Filter to project dirs whose name contains <s> (substring match)
  --json            Emit JSON instead of human-readable tables
  --dir <path>      Directory to scan for review/estimate/overhead/plan, or install target for init (default: cwd)
  --spawns N        estimate: assumed subagent spawns per run (default: derived)
  --turns N         estimate: assumed turns per agent (default: derived)
  --toolout W       estimate: tool-output weight low|med|high (default: derived)
  --out <file>      Output file for plan (default: diet-plan.md)
  --before-days A   Compare: start of "before" window (days ago)
  --after-days B    Compare: boundary between before/after (days ago); "after" = last B days
  --global          init: install to ~/.claude/skills/ instead of project .claude/skills/
  --fail-under <g>  review: exit non-zero if the grade is worse than <g> (A-F) — for CI gates
  --min-reads N     digest: only list files read at least N times (default 3)
  --classify <task> route: task description to classify into a model tier
  --scaffold        digest: write deterministic skeleton digests under .claude/digests/;
                    route: write the editable rule table under .claude/router/
  --share           savings: build the aggregate-only report + pre-filled GitHub issue link (opt-in)
  --help            Show this help

NOTE: Usage is deduplicated per API request (keyed on requestId). Claude Code
  emits 2-3 assistant lines per API call sharing identical usage — counting
  each line would inflate all token totals 2-3x. Calls = distinct API requests.

FORMULAS
  useful-work ratio  = output / (output + fresh_in + cache_write)
  avg context/call   = cache_read / calls
  est tokens in file = file_size_bytes / chars_per_token (per-extension: .md 4.2, code 3.8, .json 3.2)

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

  if (!subcommand || subcommand === '--help' || subcommand === 'help' || opts.help) {
    showHelp();
    return;
  }
  if (opts._unknown.length) {
    console.error(`token-diet: unrecognized option(s): ${opts._unknown.join(', ')}  (run \`token-diet --help\`)`);
  }

  switch (subcommand) {
    case 'audit':
      await require('../src/audit').runAudit(opts);
      break;
    case 'agents':
      await require('../src/agents').runAgents(opts);
      break;
    case 'diagnose':
      await require('../src/diagnose').runDiagnose(opts);
      break;
    case 'trace':
      if (opts.days == null) opts.days = 7;
      await require('../src/trace').runTrace(opts);
      break;
    case 'overhead':
      await require('../src/overhead').runOverhead(opts);
      break;
    case 'plan':
      if (opts.days == null) opts.days = 7;
      await require('../src/plan').runPlan(opts);
      break;
    case 'compare':
      await require('../src/compare').runCompare(opts);
      break;
    case 'burn':
      if (opts.days == null) opts.days = 2;
      await require('../src/burn').runBurn(opts);
      break;
    case 'init':
      await require('../src/init').runInit(opts);
      break;
    case 'review': {
      if (opts.failUnder && !['A', 'B', 'C', 'D', 'F'].includes(String(opts.failUnder).toUpperCase())) {
        console.error(`token-diet: --fail-under must be one of A B C D F (got "${opts.failUnder}")`);
        process.exit(2);
      }
      const { runReview } = require('../src/review-render');
      const { gradeWorseThan } = require('../src/review');
      const grade = await runReview(opts);
      if (opts.failUnder && gradeWorseThan(grade, opts.failUnder)) {
        console.error(`token-diet: grade ${grade} is below --fail-under ${opts.failUnder}`);
        process.exit(1);
      }
      break;
    }
    case 'setup':
      await require('../src/setup').runSetup(opts);
      break;
    case 'digest':
      if (opts.days == null) opts.days = 7;
      await require('../src/digest').runDigest(opts);
      break;
    case 'savings':
      await require('../src/savings').runSavings(opts);
      break;
    case 'estimate':
      await require('../src/estimate').runEstimate(opts);
      break;
    case 'fix': {
      const { runFix, runVerify } = require('../src/fix');
      if (opts.verify) {
        const problems = runVerify(opts);
        if (problems.length) process.exit(1);
      } else {
        const results = await runFix(opts);
        // A partial apply must not look like success — exit non-zero if any item errored.
        if (Array.isArray(results) && results.some(r => /^ERROR/.test(r.status || ''))) process.exit(1);
      }
      break;
    }
    case 'filter': {
      const filter = require('../src/filter');
      if (opts.selfTest)       filter.runSelfTest();
      else if (opts.install)   filter.runInstall(opts);
      else if (opts.uninstall) filter.runUninstall(opts);
      else if (opts.enable)    filter.setState(opts, true, 'audit');   // safe: records, no changes
      else if (opts.activate)  filter.setState(opts, true, 'active');  // go live
      else if (opts.disable)   filter.setState(opts, false, 'audit');   // off + reset to safe default
      else if (opts.report)    filter.runReport(opts);   // measured reduction table
      else                     filter.runFilter(opts);   // hook mode — reads stdin
      break;
    }
    case 'route':
      require('../src/router').runRoute(opts);
      break;
    case 'readgate': {
      const rg = require('../src/readgate');
      if (opts.selfTest)       rg.runSelfTest();
      else if (opts.install)   rg.runInstall(opts);
      else if (opts.uninstall) rg.runUninstall(opts);
      else if (opts.enable)    rg.setState(opts, true, 'audit');   // safe: records, denies nothing
      else if (opts.activate)  rg.setState(opts, true, 'active');  // go live
      else if (opts.disable)   rg.setState(opts, false, 'audit');  // off
      else if (opts.report)    rg.runReport(opts);                 // measured table
      else                     rg.runHook(opts);                   // hook mode — reads stdin
      break;
    }
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

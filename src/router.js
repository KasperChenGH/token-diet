'use strict';
/**
 * router.js — Lever 7 (model arbitrage) made concrete: a deterministic rule-table router.
 *
 * Turns "route mechanical work to a cheaper model" from advice into an artifact. A task
 * description is matched against an ORDERED rule table (first match wins); the matched rule
 * names a tier (haiku | sonnet | opus). This is the "scripts decide the common case, LLM
 * judges the rest" pattern (Lever 4 ∩ Lever 7): rules handle the obvious calls deterministically
 * and reserve the top tier for genuinely ambiguous prompts.
 *
 * Safety is asymmetric — we route DOWN only when confident. A high-stakes/judgment signal
 * (architecture, security, production, migration, root-cause, synthesis) ALWAYS pins to opus,
 * even if mechanical keywords are also present. Anything no rule matches defaults to opus and
 * is flagged `escalate: true` (the "send it to the top tier — or use a cheap-LLM tiebreaker"
 * fallback). We never silently downgrade. Zero-dep; pure decision logic for deterministic tests.
 *
 * NOT a learned router (RouteLLM-class): a 3-tier space does not justify training. The rule
 * table is the product; the user edits .claude/router/rules.json to fit their workload.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { writeFileAtomic } = require('./atomic');

// ── maintainer-only tier → concrete pin map (suggested frontmatter `model:` values) ──
const TIER_PIN = { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-8' };

// Ordered rule table. First rule whose `any` alternation matches the task text wins. The
// high-stakes guard is FIRST so it can't be undercut by a mechanical keyword later in the text.
const DEFAULT_RULES = [
  { tier: 'opus', label: 'high-stakes / judgment (never downgrade)', escalate: true, any: [
    'architect', 'design\\b', 'strateg', 'security', 'vulnerab', 'production', 'deploy',
    'migrat', 'trade-?off', 'ambiguous', 'root[ -]?cause', 'synthesi[sz]e', 'novel',
    '\\bdecide\\b', 'decision', 'multi-file', 'cross-cutting' ] },
  { tier: 'haiku', label: 'mechanical (extraction / format / bulk edit)', any: [
    'rename', 'reformat', 'format conversion', '\\bconvert\\b', '\\blint\\b', '\\bsort\\b',
    '\\bcount\\b', 'extract', 'bulk edit', 'boilerplate', 'find and replace', 'regex replace',
    'whitespace', '\\btypo', 'json to', '\\bcsv\\b', '\\byaml\\b', 'tabulate', 'reword' ] },
  { tier: 'sonnet', label: 'mid-complexity (review / summarize / refactor)', any: [
    '\\breview\\b', 'summar(y|i[sz]e)', 'refactor', 'document', 'docstring', 'generate tests?',
    '\\btranslate\\b', 'rewrite', 'explain', 'classif(y|ication)', 'triage', 'rubric' ] },
];

// Compile each rule's any[] into one case-insensitive alternation. rules.json is user-editable,
// so a bad pattern must never crash classification: a rule that fails to compile gets a
// never-matching sentinel (\\b\\B) and is effectively skipped, not thrown.
const NEVER = /\b\B/;
function compileRules(rules) {
  return (rules || []).map(r => {
    let _re = NEVER;
    if ((r.any || []).length) {
      try { _re = new RegExp('(' + r.any.join('|') + ')', 'i'); } catch { _re = NEVER; }
    }
    return { ...r, _re };
  });
}

// Pure: task text + rules → { tier, pin, label, escalate, matched }. No rule matched → opus, escalate.
function classifyTask(text, rules = DEFAULT_RULES) {
  const t = String(text == null ? '' : text);
  for (const r of compileRules(rules)) {
    if ((r.any || []).length && r._re.test(t)) {
      return { tier: r.tier, pin: TIER_PIN[r.tier] || r.tier, label: r.label,
               escalate: !!r.escalate, matched: true };
    }
  }
  return { tier: 'opus', pin: TIER_PIN.opus, label: 'no rule matched — default to top tier (safe)',
           escalate: true, matched: false };
}

// ── config load (project-then-global, project wins) ────────────────────────────
function rulesPath(root) { return path.join(root, '.claude', 'router', 'rules.json'); }
function loadRules(root) {
  for (const base of [path.join(os.homedir(), '.claude'), path.join(root, '.claude')]) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(base, 'router', 'rules.json'), 'utf8'));
      if (Array.isArray(j.rules) && j.rules.length) return j.rules;
    } catch { /* absent / malformed — keep looking, fall back to defaults */ }
  }
  return DEFAULT_RULES;
}

// ── CLI: classify one task ─────────────────────────────────────────────────────
function runClassify(opts = {}) {
  const root  = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const rules = loadRules(root);
  const res   = classifyTask(opts.classify, rules);
  if (opts.json) { console.log(JSON.stringify(res, null, 2)); return res; }
  console.log(`\n  task : ${String(opts.classify || '').slice(0, 80)}`);
  console.log(`  tier : ${res.tier}  (pin: ${res.pin})`);
  console.log(`  rule : ${res.label}`);
  if (res.escalate) console.log('  note : escalated to top tier — or run a cheap-LLM tiebreaker before downgrading.');
  console.log('');
  return res;
}

// ── CLI: scaffold the editable rule table + a short usage note ─────────────────
function runScaffold(opts = {}) {
  const root = opts.global ? os.homedir() : (opts.dir ? path.resolve(opts.dir) : process.cwd());
  const dir  = path.join(root, '.claude', 'router');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'rules.json');
  // Never clobber an edited rule table — scaffold creates, it does not reset.
  if (fs.existsSync(p)) { console.log(`\nrouter rules already exist (left untouched): ${p}\n  Delete the file to regenerate the defaults.\n`); return p; }
  const body = {
    _comment: 'token-diet Lever 7 router rules. Ordered: first rule whose any[] matches the task wins. '
            + 'Patterns are case-insensitive regex sources. The high-stakes rule is first so it is never '
            + 'undercut. Anything unmatched defaults to opus (escalate). Edit freely for your workload.',
    rules: DEFAULT_RULES,
  };
  writeFileAtomic(p, JSON.stringify(body, null, 2) + '\n');
  console.log(`\ntoken-diet router rules scaffolded: ${p}`);
  console.log('  Classify a task:   token-diet route --classify "rename a symbol across the repo"');
  console.log('  Measure the split: token-diet agents   (per-model output-token mix from real sessions)');
  console.log('  Pin a model by adding `model: <pin>` to the agent/command frontmatter.\n');
  return p;
}

function runSelfTest() {
  const cases = [
    ['rename a symbol across the repo',            'haiku'],
    ['summarize this PR against the review rubric', 'sonnet'],
    ['design the migration strategy for the API',   'opus'],
    ['convert this YAML config to JSON',            'haiku'],
    ['do the thing with the stuff',                 'opus'],   // unmatched → safe default
  ];
  console.log('\n=== token-diet route --self-test (fixtures) ===\n');
  for (const [text, expect] of cases) {
    const r = classifyTask(text);
    const ok = r.tier === expect ? '✔' : '✘';
    console.log(`  ${ok} ${r.tier.padEnd(6)} ${r.escalate ? '(escalate) ' : '           '}${text}`);
  }
  console.log('\nRules only — edit yours with: token-diet route --scaffold\n');
}

function runRoute(opts = {}) {
  if (opts.scaffold)            return runScaffold(opts);
  if (opts.selfTest)           return runSelfTest();
  if (opts.classify != null)    return runClassify(opts);
  console.log('\ntoken-diet route — Lever 7 model-arbitrage router');
  console.log('  --classify "<task text>"   classify one task into a model tier');
  console.log('  --scaffold                 write the editable rule table (.claude/router/rules.json)');
  console.log('  --self-test                run the built-in fixtures\n');
}

module.exports = {
  TIER_PIN, DEFAULT_RULES, compileRules, classifyTask,
  rulesPath, loadRules, runClassify, runScaffold, runSelfTest, runRoute,
};

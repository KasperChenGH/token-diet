'use strict';
/**
 * plan.js — turn diagnosis into an actionable ordered plan (markdown)
 *
 * Reuses diagnose internals to compute findings, then emits a markdown
 * checklist ordered by lever priority with concrete actions, evidence,
 * and rough savings estimates.
 *
 * An HTML-commented JSON block of machine-readable findings is appended.
 *
 * Usage:
 *   token-diet plan [--days N=7] [--project <slug>] [--out diet-plan.md]
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { scanAll }     = require('./scan');
const { charsPerToken } = require('./collectors');   // per-extension token math — keep in sync with review/estimate
const { buildChangeset } = require('./changeset');
const { appendRun }      = require('./history');
const { writeFileAtomic } = require('./atomic');

// ── shared helpers ────────────────────────────────────────────────────────────

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

// ── internals shared with diagnose ───────────────────────────────────────────

/** Build per-file session stats from records */
function buildFileMap(records) {
  const fileMap = {};
  for (const r of records) {
    if (!fileMap[r.file]) {
      fileMap[r.file] = {
        file:        r.file,
        sessionKind: r.sessionKind,
        calls:       0,
        fresh_in:    0,
        cache_write: 0,
        cache_read:  0,
        output:      0,
        timestamps:  [],
        readFiles:   {},
      };
    }
    const f = fileMap[r.file];
    f.calls       += 1;
    f.fresh_in    += r.input;
    f.cache_write += r.cacheWrite;
    f.cache_read  += r.cacheRead;
    f.output      += r.output;
    if (r.timestamp) f.timestamps.push(Date.parse(r.timestamp));
    for (const tc of r.toolCalls) {
      if (tc.name === 'Read' && tc.filePath) {
        f.readFiles[tc.filePath] = (f.readFiles[tc.filePath] || 0) + 1;
      }
    }
  }
  return Object.values(fileMap);
}

/** Compute hot files across all sessions */
function computeHotFiles(files) {
  const globalReads = {};
  for (const f of files) {
    for (const [fp, cnt] of Object.entries(f.readFiles)) {
      globalReads[fp] = (globalReads[fp] || 0) + cnt;
    }
  }
  return Object.entries(globalReads)
    .filter(([, cnt]) => cnt >= 4)
    .sort((a, b) => b[1] - a[1]);
}

/** Compute idle sessions (> 15 min of idle per session) */
function computeIdleSessions(files) {
  const result = [];
  for (const f of files) {
    if (f.timestamps.length < 2) continue;
    const sorted = f.timestamps.filter(t => !isNaN(t)).sort((a, b) => a - b);
    let idleMin = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gapMin = (sorted[i] - sorted[i - 1]) / 60_000;
      if (gapMin > 5) idleMin += gapMin;
    }
    if (idleMin > 15) result.push({ ...f, idleMin: Math.round(idleMin) });
  }
  return result.sort((a, b) => b.idleMin - a.idleMin);
}

/** Compute low-ratio agents */
function computeLowRatioAgents(files) {
  return files
    .map(f => {
      const denom = f.output + f.fresh_in + f.cache_write;
      const ratio = denom > 0 ? f.output / denom : 0;
      return { ...f, ratio };
    })
    .filter(f => f.ratio < 0.15)
    .sort((a, b) => a.ratio - b.ratio);
}

/** Compute turny sessions (> 150 calls) */
function computeTurnySessions(files) {
  return files.filter(f => f.calls > 150).sort((a, b) => b.calls - a.calls);
}

/** Compute model mix */
function computeModelMix(records) {
  const modelOut = {};
  let totalOut = 0;
  let hasSubagents = false;
  for (const r of records) {
    modelOut[r.modelFamily] = (modelOut[r.modelFamily] || 0) + r.output;
    totalOut += r.output;
    if (r.sessionKind === 'subagent') hasSubagents = true;
  }
  const topTierOut = (modelOut['opus'] || 0);
  const topTierPct = totalOut > 0 ? (topTierOut / totalOut * 100) : 0;
  return { modelOut, totalOut, topTierPct, hasSubagents };
}

/** Compute overhead items for the project dir */
function computeOverheadItems(dir) {
  const targetDir = dir ? path.resolve(dir) : process.cwd();
  const home = os.homedir();
  const items = [];

  function tryAdd(filePath, scope, label) {
    if (fs.existsSync(filePath)) {
      let lines = 0, tokens = 0;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n').length;
        tokens = Math.round(fs.statSync(filePath).size / charsPerToken(filePath));
      } catch { /* skip */ }
      items.push({ file: filePath, scope, label, lines, tokens });
    }
  }

  function globMd(dir) {
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => path.join(dir, e.name));
    } catch { return []; }
  }

  function globSkill(base, filename) {
    if (!fs.existsSync(base)) return [];
    try {
      return fs.readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => path.join(base, e.name, filename))
        .filter(p => fs.existsSync(p));
    } catch { return []; }
  }

  tryAdd(path.join(targetDir, 'CLAUDE.md'),          'per-spawn',   'project CLAUDE.md');
  tryAdd(path.join(home, '.claude', 'CLAUDE.md'),    'per-spawn',   'global CLAUDE.md');
  for (const f of globMd(path.join(targetDir, '.claude', 'commands'))) {
    tryAdd(f, 'per-session', 'project command');
  }
  for (const f of globSkill(path.join(targetDir, '.claude', 'skills'), 'SKILL.md')) {
    tryAdd(f, 'per-spawn', 'project skill');
  }
  for (const f of globSkill(path.join(home, '.claude', 'skills'), 'SKILL.md')) {
    tryAdd(f, 'per-spawn', 'global skill');
  }
  return items;
}

// ── token-per-file size helper ────────────────────────────────────────────────

function fileTokens(filePath) {
  try { return Math.round(fs.statSync(filePath).size / charsPerToken(filePath)); }
  catch { return 0; }
}

// ── day-bucket helpers ────────────────────────────────────────────────────────

function perDayAverages(records, days) {
  // Bucket totals per calendar day, then compute per-day averages
  const buckets = {};
  for (const r of records) {
    if (!r.timestamp) continue;
    const day = r.timestamp.slice(0, 10);
    if (!buckets[day]) buckets[day] = { fresh_in: 0, cache_write: 0, cache_read: 0, output: 0, calls: 0 };
    buckets[day].fresh_in    += r.input;
    buckets[day].cache_write += r.cacheWrite;
    buckets[day].cache_read  += r.cacheRead;
    buckets[day].output      += r.output;
    buckets[day].calls       += 1;
  }
  const numDays = Math.max(Object.keys(buckets).length, 1);
  const totals  = { fresh_in: 0, cache_write: 0, cache_read: 0, output: 0, calls: 0 };
  for (const b of Object.values(buckets)) {
    totals.fresh_in    += b.fresh_in;
    totals.cache_write += b.cache_write;
    totals.cache_read  += b.cache_read;
    totals.output      += b.output;
    totals.calls       += b.calls;
  }
  return {
    fresh_in:    totals.fresh_in    / numDays,
    cache_write: totals.cache_write / numDays,
    cache_read:  totals.cache_read  / numDays,
    output:      totals.output      / numDays,
    calls:       totals.calls       / numDays,
    activeDays:  numDays,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function runPlan(opts = {}) {
  const days      = opts.days != null ? +opts.days : 7;
  const outFile   = opts.out  || 'diet-plan.md';
  const projectDir = opts.dir ? path.resolve(opts.dir) : process.cwd();

  // Always emit the changeset skeleton — works with NO history (review+estimate are static).
  const csHome = os.homedir();
  const changeset = buildChangeset(projectDir, csHome);
  const csPath = path.join(projectDir, 'diet-changeset.json');
  writeFileAtomic(csPath, JSON.stringify(changeset, null, 2));
  appendRun(projectDir, { ts: new Date().toISOString(), items: changeset.items.map(i => i.id), n: changeset.items.length });
  console.log(`Changeset skeleton: ${csPath} (${changeset.items.length} items)`);

  const { records } = await scanAll({ ...opts, days });

  if (records.length === 0) {
    console.log('No records found for the given filters. Cannot generate plan.');
    console.log('  (The changeset skeleton above is still written from the static review. Widen with --days N or check --project.)');
    return;
  }

  const files    = buildFileMap(records);
  const hotFiles = computeHotFiles(files);
  const idle     = computeIdleSessions(files);
  const lowRatio = computeLowRatioAgents(files);
  const turny    = computeTurnySessions(files);
  const modelMix = computeModelMix(records);
  const overhead = computeOverheadItems(projectDir);

  const dailyAvg = perDayAverages(records, days);

  // ── Build findings list ordered by lever priority ─────────────────────────
  const findings = [];

  // Lever 1/7 — low-ratio agents
  for (const f of lowRatio.slice(0, 10)) {
    const name = path.basename(f.file, '.jsonl').slice(0, 30);
    findings.push({
      lever:   'Lever 1/7',
      title:   `Agent ${name} ratio ${f.ratio.toFixed(3)} over ${f.calls} calls — reading not thinking`,
      action:  `Make spawn conditional or downgrade model for agent \`${name}\` (ratio ${f.ratio.toFixed(3)} < 0.15)`,
      evidence:`ratio=${f.ratio.toFixed(3)}, calls=${f.calls}`,
      saving:  'Est. 15-30% reduction in that agent\'s token spend',
    });
  }

  // Lever 3 — idle babysitting
  for (const s of idle.slice(0, 5)) {
    const name = path.basename(s.file, '.jsonl').slice(0, 30);
    findings.push({
      lever:   'Lever 3',
      title:   `Session ${name} idle ${fmt(s.idleMin)} min — move long-running command to driver script`,
      action:  `Move the long-running command in session \`${name}\` to a driver script (shell/CI/cron)`,
      evidence:`idle_min=${fmt(s.idleMin)}, calls=${s.calls}`,
      saving:  'All compute-adjacent tokens; zero babysitting cost',
    });
  }

  // Lever 5 — hot files
  for (const [fp, cnt] of hotFiles.slice(0, 10)) {
    const estTok = fileTokens(fp);
    const weekSaving = Math.round(estTok * cnt * (days > 0 ? 7 / days : 1));
    const shortPath = fp.length > 60 ? '...' + fp.slice(-57) : fp;
    findings.push({
      lever:   'Lever 5',
      title:   `Create digest for ${shortPath} (read ${cnt}x, ~${fmt(estTok)} tokens/read)`,
      action:  `Create a digest (<2k token summary) for \`${fp}\`; load full file only on named-claim depth checks`,
      evidence:`read_count=${cnt}, est_tokens_per_read=${fmt(estTok)}, est_week_saved=${fmt(weekSaving)}`,
      saving:  `~${fmt(weekSaving)} tokens/week saved`,
    });
  }

  // Lever 6 — overhead trim
  for (const item of overhead.filter(i => i.lines > 100)) {
    findings.push({
      lever:   'Lever 6',
      title:   `${item.label} is ${item.lines} lines (~${fmt(item.tokens)} tokens/spawn) — trim to <=90`,
      action:  `Trim \`${item.file}\` to <=90 lines; move depth to on-demand reference files`,
      evidence:`lines=${item.lines}, est_tokens=${fmt(item.tokens)}, scope=${item.scope}`,
      saving:  `~${fmt(item.tokens)} tokens × every spawn`,
    });
  }

  // Lever 7 — model mix
  if (modelMix.topTierPct > 80 && modelMix.hasSubagents) {
    findings.push({
      lever:   'Lever 7',
      title:   `Top-tier models (opus) account for ${modelMix.topTierPct.toFixed(1)}% of output while subagents exist`,
      action:  'Route subagents to sonnet/haiku; reserve opus for synthesis and strategy turns',
      evidence:`top_tier_pct=${modelMix.topTierPct.toFixed(1)}%, has_subagents=true`,
      saving:  'Est. 3-5× cost reduction on routed share',
    });
  }

  // Cache mechanics — turny sessions
  for (const s of turny.slice(0, 3)) {
    const name = path.basename(s.file, '.jsonl').slice(0, 30);
    findings.push({
      lever:   'Cache-mech',
      title:   `Session ${name} has ${fmt(s.calls)} calls — /clear every N turns to reset cache window`,
      action:  `Add periodic /clear checkpoints to session \`${name}\` every ~100 turns`,
      evidence:`calls=${fmt(s.calls)}`,
      saving:  'Est. 5-15% cache overhead reduction',
    });
  }

  // ── Assemble markdown ─────────────────────────────────────────────────────
  const now = new Date().toISOString().slice(0, 10);
  const projectSlug = opts.project || path.basename(projectDir);

  const lines = [];
  lines.push(`# Token Diet Plan — ${projectSlug}`);
  lines.push(`Generated: ${now}  |  Window: last ${days} days`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- **Avg output/day:** ${fmt(Math.round(dailyAvg.output))} tokens`);
  lines.push(`- **Avg calls/day:** ${fmt(Math.round(dailyAvg.calls))}`);
  lines.push(`- **Per-spawn overhead:** ${fmt(overhead.filter(i => i.scope === 'per-spawn').reduce((s, i) => s + i.tokens, 0))} tokens (loads into every subagent)`);
  lines.push(`- **Hot files:** ${hotFiles.length}  |  Low-ratio agents: ${lowRatio.length}  |  Idle sessions: ${idle.length}`);
  lines.push('');
  lines.push('## Action Plan (ordered by lever priority)');
  lines.push('');

  if (findings.length === 0) {
    lines.push('No significant waste patterns detected in this window. Re-run with `--days 14` for a wider view.');
  } else {
    for (const f of findings) {
      lines.push(`- [ ] **${f.lever}:** ${f.action}`);
      lines.push(`  - Evidence: ${f.evidence}`);
      lines.push(`  - Saving: ${f.saving}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('Execute this plan with your agent. Methodology: skills/SKILL.md / https://github.com/KasperChenGH/token-diet');
  lines.push('(or: `git clone` the repo into `~/.claude/skills/`)');
  lines.push('');

  // Machine-readable JSON block (HTML comment so it doesn't render)
  const machineData = {
    generated:  now,
    project:    projectSlug,
    days,
    dailyAvg: {
      output:      Math.round(dailyAvg.output),
      calls:       Math.round(dailyAvg.calls),
      fresh_in:    Math.round(dailyAvg.fresh_in),
      cache_write: Math.round(dailyAvg.cache_write),
      cache_read:  Math.round(dailyAvg.cache_read),
    },
    findings: findings.map(f => ({
      lever:    f.lever,
      action:   f.action,
      evidence: f.evidence,
      saving:   f.saving,
    })),
    overhead: overhead.map(i => ({
      file:       i.file,
      scope:      i.scope,
      lines:      i.lines,
      est_tokens: i.tokens,
    })),
  };

  lines.push('<!--');
  lines.push('token-diet-findings:');
  lines.push(JSON.stringify(machineData, null, 2));
  lines.push('-->');

  const planContent = lines.join('\n');

  // Resolve output path
  const outPath = path.isAbsolute(outFile) ? outFile : path.join(projectDir, outFile);

  try {
    fs.writeFileSync(outPath, planContent, 'utf8');
  } catch (e) {
    console.error(`Could not write plan to ${outPath}: ${e.message}`);
    process.exit(1);
  }

  // ── Stdout summary ────────────────────────────────────────────────────────
  console.log(`\nPlan written to: ${outPath}\n`);
  console.log('5-line summary:');
  console.log(`  Window:          last ${days} days  (${records.length} API calls)`);
  console.log(`  Avg output/day:  ${fmt(Math.round(dailyAvg.output))} tokens  (${fmt(Math.round(dailyAvg.calls))} calls/day)`);
  console.log(`  Per-spawn load:  ${fmt(overhead.filter(i => i.scope === 'per-spawn').reduce((s, i) => s + i.tokens, 0))} tokens (every subagent pays this)`);
  console.log(`  Action items:    ${findings.length} (hot_files=${hotFiles.length}, low_ratio=${lowRatio.length}, idle=${idle.length}, overhead_trim=${overhead.filter(i => i.lines > 100).length})`);
  console.log(`  Top lever:       ${findings.length > 0 ? findings[0].lever + ' — ' + findings[0].title.slice(0, 60) : 'none'}`);
  console.log('');
}

module.exports = { runPlan };

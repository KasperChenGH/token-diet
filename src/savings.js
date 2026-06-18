'use strict';
/**
 * savings.js — "how much did I save?" report + opt-in, privacy-safe feedback.
 *
 * Prints a per-lever / per-section reduction table:
 *   • structural levers  → PROJECTED from `estimate` (a model, labelled as such)
 *   • output filter      → MEASURED from .claude/toolout/stats.jsonl (real sessions)
 *
 * `--share` builds a STRICTLY AGGREGATE payload (reduction %, lever counts, grade, token
 * buckets, version, OS, a random anonymous install id) — NEVER file names, paths, commands,
 * content, or project names — and prints a pre-filled GitHub issue link the USER chooses to
 * submit. Nothing is sent automatically. If TOKEN_DIET_TELEMETRY_URL is set, the same payload
 * is POSTed there (for a maintainer's own private collection); unset (the default, and the
 * case in the public repo) → no network call at all. Zero-dependency (Node https only).
 */
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const estimate = require('./estimate');
const review   = require('./review');
const filter   = require('./filter');

const REPO = 'KasperChenGH/token-diet';
const pkg  = (() => { try { return require('../package.json'); } catch { return {}; } })();
const fmt  = n => Math.round(n).toLocaleString('en-US');

// Stable per-install anonymous id (random; stored once, never tied to identity).
function installId(home) {
  const p = path.join(home, '.claude', 'toolout', 'install-id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* create below */ }
  const id = crypto.randomUUID();
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, id + '\n'); } catch { /* best-effort */ }
  return id;
}

// Read the measured filter stats (if any) into an aggregate.
function filterStats(root) {
  try {
    const entries = fs.readFileSync(path.join(root, '.claude', 'toolout', 'stats.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!entries.length) return null;
    return filter.aggregateStats(entries);   // { rows:[{kind,count,raw,comp,pct}], total }
  } catch { return null; }
}

// Build the report data (also the basis for the sanitized share payload).
function computeSavings(opts = {}) {
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const home = opts._home || os.homedir();
  const est  = estimate.computeEstimate({ ...opts, dir: root, _home: home });   // projection
  const { grade } = review.analyze(root, home);
  const stats = filterStats(root);
  return { root, home, grade, est, stats };
}

function printTable(d) {
  const { est, stats, grade } = d;
  console.log('\n=== token-diet — your token reduction ===\n');
  console.log(`Project grade: ${grade}`);

  // Projected structural levers
  console.log('\nStructural levers (PROJECTED — a model from `estimate`, not yet measured):');
  console.log('  lever | weighted tokens saved/run');
  console.log('  ------+--------------------------');
  for (const s of est.s.savers) {
    const name = review.LEVER_NAMES[s.lever] || ('L' + s.lever);
    console.log(`  ${('L' + s.lever).padEnd(5)} | ${fmt(s.weightedSaved).padStart(10)}   ${name}`);
  }
  console.log(`  → if all flagged levers fixed: -${est.pct}% of the projected per-run bill`);

  // Measured filter
  if (stats) {
    console.log('\nOutput filter (MEASURED — your real sessions):');
    console.log('  type                   |  calls |    before |     after | reduction');
    console.log('  -----------------------+--------+-----------+-----------+----------');
    const KIND = { tests: 'tests', git: 'git', build: 'builds', read: 'large reads', log: 'logs / other' };
    for (const r of stats.rows)
      console.log(`  ${(KIND[r.kind] || r.kind).padEnd(22)} | ${String(r.count).padStart(6)} | ${fmt(r.raw).padStart(9)} | ${fmt(r.comp).padStart(9)} | ${('-' + r.pct + '%').padStart(8)}`);
    console.log(`  ${'TOTAL'.padEnd(22)} | ${String(stats.total.count).padStart(6)} | ${fmt(stats.total.raw).padStart(9)} | ${fmt(stats.total.comp).padStart(9)} | ${('-' + stats.total.pct + '%').padStart(8)}`);
  } else {
    console.log('\nOutput filter: no measured data yet — run `token-diet setup`, use Claude Code a bit, then `filter --report`.');
  }
  console.log('\nProjected rows are a model; the filter row is measured (token ≈ chars/4). For the');
  console.log('whole-session before/after, run `token-diet compare`.  Share results: `--share`.\n');
}

// STRICTLY AGGREGATE — no paths, names, commands, or content. Auditable via --dry-run.
function sharePayload(d) {
  return {
    schema: 'token-diet/savings/1',
    version: pkg.version || 'unknown',
    os: process.platform,
    node: process.version,
    installId: installId(d.home),
    grade: d.grade,
    projectedReductionPct: d.est.pct,
    flaggedLevers: d.est.levers,                       // lever NUMBERS only
    projectedSaversWeighted: d.est.s.savers.map(s => ({ lever: s.lever, weighted: s.weightedSaved })),
    filter: d.stats ? {
      totalCalls: d.stats.total.count,
      reductionPct: d.stats.total.pct,
      byKind: d.stats.rows.map(r => ({ kind: r.kind, calls: r.count, pct: r.pct })),
    } : null,
  };
}

function githubIssueUrl(payload) {
  const title = `telemetry: token-diet ${payload.version} · grade ${payload.grade} · projected -${payload.projectedReductionPct}%`;
  const body = '```json\n' + JSON.stringify(payload, null, 2) + '\n```\n\n' +
    '_Aggregate-only stats from `token-diet savings --share`. No file names, paths, or content. Edit/remove anything before submitting._';
  const q = `title=${encodeURIComponent(title)}&labels=telemetry&body=${encodeURIComponent(body)}`;
  return `https://github.com/${REPO}/issues/new?${q}`;
}

function postTelemetry(url, payload) {
  return new Promise(resolve => {
    try {
      const https = require('https');
      const data = JSON.stringify(payload);
      const u = new URL(url);
      const req = https.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', () => resolve(null));
      req.write(data); req.end();
    } catch { resolve(null); }
  });
}

async function runSavings(opts = {}) {
  const d = computeSavings(opts);
  if (opts.json && !opts.share) { console.log(JSON.stringify({ grade: d.grade, projectedPct: d.est.pct, filter: d.stats && d.stats.total }, null, 2)); return; }
  if (!opts.share) { printTable(d); return; }

  // ── share flow (opt-in; the user runs --share explicitly) ──
  const payload = sharePayload(d);
  console.log('\n=== token-diet savings --share (aggregate-only — review before sending) ===\n');
  console.log(JSON.stringify(payload, null, 2));
  if (opts.dryRun) { console.log('\n[--dry-run] nothing sent. This is the entire payload.\n'); return; }

  const url = process.env.TOKEN_DIET_TELEMETRY_URL;
  if (url) {
    const code = await postTelemetry(url, payload);
    console.log(`\nPOSTed to TOKEN_DIET_TELEMETRY_URL → ${code == null ? 'failed (offline?) — nothing lost' : 'HTTP ' + code}`);
  } else {
    console.log('\nNo TOKEN_DIET_TELEMETRY_URL set — nothing was sent automatically.');
    console.log('To share these aggregate numbers, open this pre-filled GitHub issue and submit:\n');
    console.log('  ' + githubIssueUrl(payload));
    console.log('\n(GitHub issues are PUBLIC; the payload above is all that goes in it.)\n');
  }
}

module.exports = { runSavings, computeSavings, sharePayload, githubIssueUrl, installId };

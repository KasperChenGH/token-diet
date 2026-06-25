'use strict';
/**
 * review-render.js — the human-readable + JSON renderer for `token-diet review`.
 *
 * Split out of review.js so that module owns analysis/detection (analyze + the lever checks)
 * and this one owns presentation. Requires ./review for the analysis surface it prints; the
 * cycle is safe because review.js attaches this module's runReview only AFTER its own exports
 * are populated, and runReview reads those exports at call time, never at load.
 */
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const history = require('./history');
const review  = require('./review');   // analyze, LEVER_NAMES, worstSev, fmt, gradeWorseThan

// Presentation helpers (used only by the renderer).
function padL(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }
function hline(ws)  { return ws.map(w => '-'.repeat(w)).join('-+-'); }

async function runReview(opts = {}) {
  const targetDir = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const home      = os.homedir();

  const { findings, projectFindings, allCommandFiles, overheadRows, perSpawnTotal, grade } = review.analyze(targetDir, home);
  const { LEVER_NAMES, worstSev, fmt, gradeWorseThan } = review;
  const globalFindings = findings.filter(f => f.scope === 'global');

  // Detect whether any project-level Claude Code artifacts exist
  const hasProjectArtifacts = fs.existsSync(path.join(targetDir, 'CLAUDE.md')) || fs.existsSync(path.join(targetDir, '.claude'));

  // --record stamps the current grade as the drift baseline (used by the agent's Phase 5 and
  // `setup`). Plain `review` later compares against it and nudges if the structure regressed.
  if (opts.record && grade !== 'N/A') {
    try { history.setBaseline(targetDir, { grade, findings: projectFindings.length, ts: new Date().toISOString() }); }
    catch { /* history is best-effort — never break review */ }
  }

  // ── Build per-lever scorecard (project scope only) ───────────────────────
  const leverFindings = {};
  for (let i = 1; i <= 8; i++) leverFindings[i] = [];
  for (const f of projectFindings) leverFindings[f.lever].push(f);

  // ── JSON output ──────────────────────────────────────────────────────────
  if (opts.json) {
    const scorecard = Object.fromEntries(
      Object.entries(leverFindings).map(([lever, flist]) => [
        lever,
        {
          lever_name:    LEVER_NAMES[+lever],
          status:        flist.length === 0 ? 'OK' : `${flist.length} findings`,
          worst_severity: worstSev(flist),
          findings:      flist,
        },
      ])
    );
    console.log(JSON.stringify({
      dir:              targetDir,
      grade,
      grade_basis:      'project-scope findings only',
      scorecard,
      findings,
      global_findings:  globalFindings,
      overhead: {
        files:         overheadRows.map(r => ({ file: r.file, label: r.label, scope: r.scope, lines: r.lines, tokens: r.tokens })),
        per_spawn_tokens: perSpawnTotal,
        agent_cost:    { n1: perSpawnTotal, n5: perSpawnTotal * 5, n10: perSpawnTotal * 10 },
      },
    }, null, 2));
    return grade;
  }

  // ── Human-readable output ────────────────────────────────────────────────
  console.log('\n=== token-diet review (STATIC) ===\n');
  console.log(`Directory : ${targetDir}`);
  console.log(`Files scanned : ${allCommandFiles.length} command/agent/skill/CLAUDE.md files\n`);

  // No-project-artifacts guard
  if (!hasProjectArtifacts) {
    console.log(`NOTE: No project-level Claude Code config found in ${targetDir} — showing global infrastructure review only\n`);
  }

  // Scorecard table (project scope)
  console.log('--- Scorecard (project-scope findings only) ---\n');
  const scColW = [5, 30, 20, 14];
  const scHdr  = ['Lever', 'Name', 'Status', 'Worst Sev'];
  console.log(scHdr.map((h, i) => i === 0 ? padR(h, scColW[i]) : i === 1 ? padL(h, scColW[i]) : padL(h, scColW[i])).join('  |  '));
  console.log(hline(scColW));

  for (let i = 1; i <= 8; i++) {
    const flist  = leverFindings[i];
    const status = flist.length === 0 ? 'OK' : `${flist.length} finding${flist.length > 1 ? 's' : ''}`;
    const wsev   = worstSev(flist) || '-';
    const cols   = [String(i), LEVER_NAMES[i], status, wsev];
    console.log(cols.map((c, j) => j === 0 ? padR(c, scColW[j]) : padL(c, scColW[j])).join('  |  '));
  }
  console.log('');

  // Project findings grouped by lever, sorted severity desc
  const sevOrder = { high: 0, med: 1, low: 2 };
  const sortedProjectFindings = [...projectFindings].sort((a, b) => {
    if (a.lever !== b.lever) return a.lever - b.lever;
    return (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9);
  });

  if (sortedProjectFindings.length === 0) {
    console.log('No project-scope findings — this project looks lean!\n');
  } else {
    console.log('--- Findings ---\n');
    let currentLever = null;
    for (const f of sortedProjectFindings) {
      if (f.lever !== currentLever) {
        currentLever = f.lever;
        console.log(`[Lever ${f.lever}] ${LEVER_NAMES[f.lever]}`);
      }
      const shortFile = f.file.length > 72 ? '...' + f.file.slice(-69) : f.file;
      const sevLabel  = f.severity.toUpperCase().padEnd(4);
      console.log(`  ${sevLabel}  ${shortFile}`);
      console.log(`        Evidence: ${f.evidence}`);
      console.log(`        Fix:      ${f.recommendation}`);
      console.log('');
    }
  }

  // Overall grade (project scope only)
  if (grade === 'N/A') {
    console.log('--- Overall Grade: N/A (no project-level artifacts found) ---');
  } else {
    console.log(`--- Overall Grade: ${grade} ---`);
  }
  console.log('  (A=lean, F=heavy; based on project-scope findings only — heuristic)\n');

  // Global infrastructure section
  if (globalFindings.length > 0) {
    console.log('--- Global infrastructure (fix once — affects every project on this machine) ---\n');
    const sortedGlobal = [...globalFindings].sort((a, b) => {
      if (a.lever !== b.lever) return a.lever - b.lever;
      return (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9);
    });
    let currentLever = null;
    for (const f of sortedGlobal) {
      if (f.lever !== currentLever) {
        currentLever = f.lever;
        console.log(`[Lever ${f.lever}] ${LEVER_NAMES[f.lever]}`);
      }
      const shortFile = f.file.length > 72 ? '...' + f.file.slice(-69) : f.file;
      const sevLabel  = f.severity.toUpperCase().padEnd(4);
      console.log(`  ${sevLabel}  ${shortFile}`);
      console.log(`        Evidence: ${f.evidence}`);
      console.log(`        Fix:      ${f.recommendation}`);
      console.log('');
    }
  }

  // Per-spawn cost summary (condensed from overhead)
  if (overheadRows.length > 0) {
    console.log('--- Overhead snapshot (Lever 6) ---\n');
    const colW    = [54, 12, 8, 11];
    const headers = ['file', 'scope', 'lines', 'est_tokens'];
    console.log('  ' + headers.map((h, i) => i < 2 ? padL(h, colW[i]) : padR(h, colW[i])).join(' | '));
    console.log('  ' + hline(colW));
    for (const r of overheadRows) {
      const sp = r.file.length > 52 ? '...' + r.file.slice(-49) : r.file;
      const row = [sp, r.scope, String(r.lines), fmt(r.tokens)];
      console.log('  ' + row.map((c, i) => i < 2 ? padL(c, colW[i]) : padR(c, colW[i])).join(' | '));
    }
    console.log('');
    console.log(`  Per-spawn total: ${fmt(perSpawnTotal)} tokens`);
    console.log('  Cost if N agents spawned:');
    for (const n of [1, 5, 10]) {
      console.log(`    N=${String(n).padEnd(3)} ${fmt(perSpawnTotal * n).padStart(10)} tokens`);
    }
    console.log('');
  }

  // Regrowth nudge: if the structure regressed since the last token-diet optimization, say so
  // loudly and point at the one fix. This is what makes the pre-commit drift gate self-reminding —
  // the user re-runs /token-diet because they're told to, not on a guess. Read-only.
  if (!opts.record && grade !== 'N/A') {
    const base = history.getBaseline(targetDir);
    if (base && base.grade && base.grade !== 'N/A' && gradeWorseThan(grade, base.grade)) {
      console.log('⚠  Structural drift: grade regressed ' + base.grade + ' → ' + grade +
        ' since your last token-diet run (' + projectFindings.length + ' findings now).');
      console.log('   Run `/token-diet` to re-optimize.\n');
    }
  }

  console.log('─'.repeat(72));
  console.log('This is a STATIC design review (no usage history needed).');
  console.log('For measured usage, run `token-diet audit/diagnose` after sessions.');
  console.log('Execute fixes with the token-diet agent (`/token-diet`).');
  console.log('');
  return grade;
}

module.exports = { runReview };

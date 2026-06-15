'use strict';
/**
 * review.js — STATIC project/spec review: score token-efficiency against the 8 levers
 *
 * Reads Claude Code design artifacts (CLAUDE.md, commands, agents, skills,
 * settings, knowledge/) and emits per-lever findings + an overall grade.
 * No transcript history required.
 *
 * Levers:
 *  1  Delete ceremonial agents (unconditional low-body spawns)
 *  2  Merge sessions / collapse multi-phase flows
 *  3  Evict in-session compute (long builds, sweeps, test suites)
 *  4  Scripts for determinism (LLM doing arithmetic/ranking/diffing)
 *  5  Tier knowledge (digest/index missing for large reference dirs)
 *  6  Always-loaded overhead (CLAUDE.md + commands + skills size)
 *  7  Model arbitrage (no pin = top-tier by default; all pins too expensive)
 *  8  Filter tool output (verbose test/build/log stdout re-sent every turn)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── small helpers ─────────────────────────────────────────────────────────────

function fmt(n)     { return Math.round(n).toLocaleString('en-US'); }
function padL(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }
function hline(ws)  { return ws.map(w => '-'.repeat(w)).join('-+-'); }

function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

function countLines(content) {
  if (content == null) return 0;
  return content.split('\n').length;
}

function estTokens(filePath) {
  try { return Math.round(fs.statSync(filePath).size / 4); }
  catch { return 0; }
}

/** Glob *.md files one level deep */
function globMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md'))
        results.push(path.join(dir, e.name));
    }
  } catch { /* unreadable */ }
  return results;
}

/** Glob */
function globSkillFiles(baseDir, filename) {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;
  try {
    for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const candidate = path.join(baseDir, e.name, filename);
        if (fs.existsSync(candidate)) results.push(candidate);
      }
    }
  } catch { /* unreadable */ }
  return results;
}

/** Recursively walk a directory, returning all file paths */
function walkDir(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(full, results);
      else if (e.isFile())  results.push(full);
    }
  } catch { /* unreadable */ }
  return results;
}

/** YAML-ish frontmatter: look for `model: <value>` in first 20 lines */
function parseFrontmatterModel(content) {
  if (!content) return null;
  const lines = content.split('\n').slice(0, 20);
  for (const line of lines) {
    const m = line.match(/^\s*model\s*:\s*["']?([^\s"'#]+)["']?/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function modelTier(modelStr) {
  if (!modelStr) return 'unknown';
  const m = modelStr.toLowerCase();
  if (m.includes('opus')) return 'top';
  if (m.includes('sonnet'))                       return 'mid';
  if (m.includes('haiku'))                        return 'low';
  return 'other';
}

function isTopTier(modelStr) { return modelTier(modelStr) === 'top'; }

// ── finding builder ───────────────────────────────────────────────────────────

// Populated once runReview() resolves targetDir and home
let _targetDir = null;
let _home      = null;

function deriveScope(filePath) {
  if (!filePath || !_targetDir || !_home) return 'project';
  const norm    = path.resolve(filePath);
  const projDot = path.join(_targetDir, '.claude');
  const globDot = path.join(_home, '.claude');
  // project CLAUDE.md lives directly in targetDir
  if (norm === path.join(_targetDir, 'CLAUDE.md')) return 'project';
  // global CLAUDE.md
  if (norm === path.join(_home, '.claude', 'CLAUDE.md')) return 'global';
  // anything under ~/.claude/
  if (norm.startsWith(globDot + path.sep) || norm === globDot) return 'global';
  // anything under <targetDir>/.claude/
  if (norm.startsWith(projDot + path.sep) || norm === projDot) return 'project';
  // fallback: if it's under targetDir at all, treat as project
  if (norm.startsWith(_targetDir + path.sep) || norm === _targetDir) return 'project';
  return 'global';
}

function finding(lever, severity, file, evidence, recommendation) {
  return { lever, severity, file, evidence, recommendation, scope: deriveScope(file) };
}

// severity weights for grade
const SEV_WEIGHT = { high: 3, med: 2, low: 1 };

// ── LEVER 6 — always-loaded overhead ─────────────────────────────────────────

function checkLever6(targetDir, home, findings) {
  // Re-use same logic as overhead.js but produce findings instead of printing

  const candidates = [];

  const projClaude = path.join(targetDir, 'CLAUDE.md');
  if (fs.existsSync(projClaude))
    candidates.push({ file: projClaude, label: 'project CLAUDE.md', scope: 'per-spawn' });

  const globalClaude = path.join(home, '.claude', 'CLAUDE.md');
  if (fs.existsSync(globalClaude))
    candidates.push({ file: globalClaude, label: 'global CLAUDE.md', scope: 'per-spawn' });

  for (const f of globMdFiles(path.join(targetDir, '.claude', 'commands')))
    candidates.push({ file: f, label: 'project command', scope: 'per-session' });

  for (const f of globMdFiles(path.join(home, '.claude', 'commands')))
    candidates.push({ file: f, label: 'global command', scope: 'per-session' });

  for (const f of globSkillFiles(path.join(targetDir, '.claude', 'skills'), 'SKILL.md'))
    candidates.push({ file: f, label: 'project skill', scope: 'per-spawn' });

  for (const f of globSkillFiles(path.join(home, '.claude', 'skills'), 'SKILL.md'))
    candidates.push({ file: f, label: 'global skill', scope: 'per-spawn' });

  // Also check .claude/agents/*.md
  for (const f of globMdFiles(path.join(targetDir, '.claude', 'agents')))
    candidates.push({ file: f, label: 'project agent', scope: 'per-session' });

  const rows = candidates.map(c => {
    const content = readText(c.file);
    return { ...c, lines: countLines(content), tokens: estTokens(c.file) };
  });

  const perSpawnTotal = rows.filter(r => r.scope === 'per-spawn')
                            .reduce((s, r) => s + r.tokens, 0);

  // Flag files > 100 lines
  for (const r of rows) {
    if (r.lines > 100) {
      const sev = r.lines > 250 ? 'high' : 'med';
      findings.push(finding(
        6,
        sev,
        r.file,
        `${r.lines} lines (~${fmt(r.tokens)} tokens) [${r.label}]`,
        'Trim to <=90 lines; move depth to on-demand reference files'
      ));
    }
  }

  // Project spawn-cost summary (informational low if very large)
  const cost10 = perSpawnTotal * 10;
  if (cost10 > 500_000) {
    findings.push(finding(
      6,
      'high',
      targetDir,
      `Per-spawn overhead ~${fmt(perSpawnTotal)} tokens → ${fmt(cost10)} tokens if 10 agents spawned`,
      'Reduce CLAUDE.md and skill sizes; consider which files truly need per-spawn scope'
    ));
  } else if (cost10 > 200_000) {
    findings.push(finding(
      6,
      'med',
      targetDir,
      `Per-spawn overhead ~${fmt(perSpawnTotal)} tokens → ${fmt(cost10)} tokens if 10 agents spawned`,
      'Consider trimming CLAUDE.md; move reference details to on-demand files'
    ));
  }

  return { rows, perSpawnTotal };
}

// ── LEVER 1 — delete ceremonial agents ───────────────────────────────────────

// Signals that a command/agent spawns sub-agents
const SPAWN_RE = /subagent|spawn|agent tool|parallel agents|\bN subagents\b|fan[- ]out|\bSubagent \d/gi;

// Guards that indicate conditional spawning
const GUARD_RE = /\bonly if\b|\bwhen\b|\bskip\b|\bif .{0,30}(found|needed|detected|present|exists|match)/i;

function checkLever1(allCommandFiles, findings) {
  let totalAgentDefs = allCommandFiles.length;
  let spawnHeavyCount = 0;

  for (const { file, content } of allCommandFiles) {
    if (!content) continue;

    // Count spawn signals
    const matches = content.match(new RegExp(SPAWN_RE.source, 'gi')) || [];
    const spawnCount = matches.length;

    if (spawnCount >= 3) {
      spawnHeavyCount++;
      findings.push(finding(
        1,
        'med',
        file,
        `${spawnCount} spawn signals detected (${matches.slice(0, 3).join(', ')}...)`,
        'Consider whether all agent fans are necessary; merge specialists or make spawning conditional'
      ));
    }

    // Ceremonial agent: body < 40 lines AND no conditional guard nearby spawn signals
    const lines = countLines(content);
    if (lines < 40 && spawnCount >= 1) {
      // Check for a guard near each spawn signal
      const hasGuard = GUARD_RE.test(content);
      if (!hasGuard) {
        findings.push(finding(
          1,
          'low',
          file,
          `Short agent (${lines} lines) spawns unconditionally — possible ceremonial agent`,
          'Add a guard ("only if X", "skip when") or merge into parent command'
        ));
      }
    }
  }

  return { totalAgentDefs, spawnHeavyCount };
}

// ── LEVER 2 — merge sessions ──────────────────────────────────────────────────

// Patterns indicating multiple phases / sessions per cycle
const MULTI_SESSION_RE = /\bprepare\b|\bfinalize\b|\bphase [12]\b|>=\s*2\s*sessions?|\/clear\s+between|\bStep [1-7]\b.*\bStep [2-7]\b/gi;
const LINEAR_FLOW_RE   = /^#+\s*Step [1-9]/gim;  // numbered H2/H3 steps

function checkLever2(allCommandFiles, findings) {
  for (const { file, content } of allCommandFiles) {
    if (!content) continue;

    const phaseMatches = content.match(/\bprepare\b|\bfinalize\b/gi) || [];
    const stepHeaders  = content.match(LINEAR_FLOW_RE) || [];
    const clearBetween = /\/clear\s+between|\/clear.*between steps/i.test(content);
    const multiSession = />=\s*2\s*sessions?/i.test(content);

    if (phaseMatches.length >= 2) {
      findings.push(finding(
        2,
        'med',
        file,
        `Found "prepare"+"finalize" mode pair — implies >= 2 sessions per cycle`,
        'Merge prepare+finalize into a single session; use in-session state to bridge phases'
      ));
    }

    if (stepHeaders.length >= 5) {
      findings.push(finding(
        2,
        'low',
        file,
        `${stepHeaders.length}-step linear session flow (${stepHeaders.slice(0, 3).map(s => s.trim()).join(', ')}...)`,
        'Long linear step flows often hide places to /clear earlier; audit which steps genuinely need prior context'
      ));
    }

    if (clearBetween) {
      findings.push(finding(
        2,
        'high',
        file,
        'Explicit "/clear between steps" — each phase loads the full prior context unnecessarily',
        'Redesign as a single session with state passed via files, not context window'
      ));
    }

    if (multiSession) {
      findings.push(finding(
        2,
        'med',
        file,
        'Mentions ">= 2 sessions" per cycle',
        'Review whether both sessions are needed or can be merged with minimal context bleed'
      ));
    }
  }
}

// ── LEVER 3 — evict in-session compute ────────────────────────────────────────

const COMPUTE_RE = /\b(build|compile|test suite|train|backtest|sweep|npm install|docker|webpack|\d+\s*(min|hour|h)\b)/gi;

function checkLever3(allCommandFiles, findings) {
  for (const { file, content } of allCommandFiles) {
    if (!content) continue;

    const matches = [];
    let m;
    const re = new RegExp(COMPUTE_RE.source, 'gi');
    while ((m = re.exec(content)) !== null) {
      // grab a short snippet of context around the match
      const start  = Math.max(0, m.index - 20);
      const end    = Math.min(content.length, m.index + m[0].length + 40);
      const snip   = content.slice(start, end).replace(/\n/g, ' ').trim();
      matches.push({ phrase: m[0], snip });
      if (matches.length >= 5) break; // cap per file
    }

    if (matches.length > 0) {
      const phrases = [...new Set(matches.map(x => x.phrase.toLowerCase()))].slice(0, 4).join(', ');
      findings.push(finding(
        3,
        'med',
        file,
        `In-session compute described: "${phrases}"`,
        'Offload long-running commands to background tasks / Cron / external scripts; keep LLM session idle-free'
      ));
    }
  }
}

// ── LEVER 4 — scripts for determinism ─────────────────────────────────────────

const DETERMINISM_RE = /\bcompute the\b|\bcalculate\b|\bscore each\b|\bsum \b|\btally\b|\branking\b|\brank \b|\bdiff \b|\bcount the\b|\bverdict\b|\bmargin\b/gi;

function checkLever4(allCommandFiles, findings) {
  for (const { file, content } of allCommandFiles) {
    if (!content) continue;

    const matches = content.match(new RegExp(DETERMINISM_RE.source, 'gi')) || [];
    if (matches.length >= 3) {
      const uniq = [...new Set(matches.map(x => x.toLowerCase()))].slice(0, 5);
      const sev  = matches.length >= 6 ? 'high' : 'med';
      findings.push(finding(
        4,
        sev,
        file,
        `${matches.length} determinism phrases: "${uniq.join('", "')}"`,
        'Extract scoring/ranking/counting into a deterministic script; LLM should only interpret results'
      ));
    }
  }
}

// ── LEVER 5 — tier knowledge ──────────────────────────────────────────────────

function checkLever5(targetDir, allCommandFiles, findings) {
  const knowledgeDirs = ['knowledge', 'docs', 'doc', 'ref', 'references'];
  let foundKnowledgeDir = null;
  let allKnowledgeFiles = [];

  for (const dirname of knowledgeDirs) {
    const candidate = path.join(targetDir, dirname);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      foundKnowledgeDir = candidate;
      allKnowledgeFiles = walkDir(candidate);
      break;
    }
  }

  if (foundKnowledgeDir && allKnowledgeFiles.length > 0) {
    // Check for a digest/summary/index file
    const hasDigest = allKnowledgeFiles.some(f => {
      const lower = f.toLowerCase();
      return lower.includes('digest') || lower.includes('summary') || lower.includes('index');
    });

    const fileCount = allKnowledgeFiles.length;
    const totalBytes = allKnowledgeFiles.reduce((s, f) => {
      try { return s + fs.statSync(f).size; } catch { return s; }
    }, 0);
    const totalTokens = Math.round(totalBytes / 4);

    if (!hasDigest && fileCount >= 5) {
      const sev = fileCount >= 15 ? 'high' : 'med';
      findings.push(finding(
        5,
        sev,
        foundKnowledgeDir,
        `${fileCount} reference files (~${fmt(totalTokens)} tokens total) with NO digest/summary/index`,
        'Create digest files (one per topic area, ~2k tokens each) so commands load digests first and pull full files only on demand'
      ));
    }
  }

  // Flag "read all" + (files|knowledge|docs) patterns in commands
  for (const { file, content } of allCommandFiles) {
    if (!content) continue;
    if (/read all\s+(files|knowledge|docs|reference)/i.test(content)) {
      findings.push(finding(
        5,
        'med',
        file,
        'Contains "read all <files/knowledge/docs>" — bulk-loads entire reference corpus',
        'Replace with "read digest first, pull full file only when claim needs verification"'
      ));
    }
  }
}

// ── LEVER 7 — model arbitrage ──────────────────────────────────────────────────

function checkLever7(allCommandFiles, findings) {
  const unpinned   = [];
  const topPinned  = [];
  const midOrLow   = [];

  for (const { file, content } of allCommandFiles) {
    const modelPin = parseFrontmatterModel(content || '');
    if (!modelPin) {
      // Check if the file body mentions a model pin inline (e.g. `model: "sonnet"` in a prompt block)
      const inlinePin = content && content.match(/model\s*:\s*["']?([a-zA-Z0-9._-]+)["']?/i);
      if (!inlinePin) {
        unpinned.push(file);
      }
      // If inline pin found, don't flag — they've thought about it
    } else {
      if (isTopTier(modelPin)) topPinned.push({ file, model: modelPin });
      else midOrLow.push({ file, model: modelPin });
    }
  }

  // Flag unpinned agents/commands (will inherit session model = often top-tier)
  if (unpinned.length >= 3) {
    const sev = unpinned.length >= 6 ? 'high' : 'med';
    findings.push(finding(
      7,
      sev,
      unpinned[0],
      `${unpinned.length} command/agent files have no model pin (inherit session model)`,
      'Add `model: "sonnet"` frontmatter to mechanical agents; reserve top-tier for synthesis/judgment'
    ));
  } else if (unpinned.length > 0) {
    findings.push(finding(
      7,
      'low',
      unpinned[0],
      `${unpinned.length} command/agent file(s) have no model pin`,
      'Pin model in frontmatter to prevent accidental top-tier spend'
    ));
  }

  // Flag if ALL pinned files use top-tier and there are no mid/low pins
  if (topPinned.length >= 2 && midOrLow.length === 0) {
    findings.push(finding(
      7,
      'high',
      topPinned[0].file,
      `All ${topPinned.length} pinned files use top-tier model (${topPinned[0].model}); no sonnet/haiku pins found`,
      'Route mechanical subagents (preflight, analysis parsers, bulk edits) to sonnet or haiku'
    ));
  }
}

// ── scorecard + grade ─────────────────────────────────────────────────────────

const LEVER_NAMES = {
  1: 'Delete ceremonial agents',
  2: 'Merge sessions',
  3: 'Evict in-session compute',
  4: 'Scripts for determinism',
  5: 'Tier knowledge',
  6: 'Always-loaded overhead',
  7: 'Model arbitrage',
  8: 'Filter tool output',
};

function computeGrade(findings) {
  // Cap each lever's contribution at 6 (≈2 high findings) so a single file
  // with 10 high findings doesn't dominate. Max possible: 8 levers × 6 = 48.
  const byLever = {};
  for (const f of findings) {
    if (!byLever[f.lever]) byLever[f.lever] = 0;
    byLever[f.lever] += SEV_WEIGHT[f.severity] || 0;
  }

  // Cap each lever at 6 (2 high findings equiv)
  let total = 0;
  for (const v of Object.values(byLever)) total += Math.min(v, 6);

  const maxPossible = 8 * 6; // 48
  const ratio = total / maxPossible;

  if (ratio <= 0.05) return 'A';
  if (ratio <= 0.15) return 'B';
  if (ratio <= 0.30) return 'C';
  if (ratio <= 0.50) return 'D';
  return 'F';
}

function worstSev(findings) {
  if (findings.some(f => f.severity === 'high')) return 'high';
  if (findings.some(f => f.severity === 'med'))  return 'med';
  if (findings.some(f => f.severity === 'low'))  return 'low';
  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────

// ── LEVER 8 — filter tool output (no-history likely-risk flag) ────────────────

function hasPostToolUseHook(targetDir, home) {
  for (const base of [path.join(targetDir, '.claude'), path.join(home, '.claude')]) {
    for (const f of ['settings.json', 'settings.local.json']) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
        if (j && j.hooks && j.hooks.PostToolUse) return true;
      } catch { /* missing/invalid */ }
    }
  }
  return false;
}
const TOOLOUT_RE = /\b(test|build|log|pytest|jest|docker|webpack|npm (?:run|test))\b/i;
function checkLever8(targetDir, home, allCommandFiles, findings) {
  if (hasPostToolUseHook(targetDir, home)) return;
  const hits = allCommandFiles.filter(c => c.content && TOOLOUT_RE.test(c.content));
  if (hits.length >= 1) {
    findings.push(finding(8, 'med', hits[0].file,
      `${hits.length} file(s) mention test/build/log with no PostToolUse output-filter hook (likely re-send risk)`,
      'Add a PostToolUse output filter (scaffold a hook) so verbose stdout is not re-sent every turn'));
  }
}

// ── likely-verbose heuristic (F3): large file + low heading density ───────────
function checkVerbose(allCommandFiles, findings) {
  for (const { file, content } of allCommandFiles) {
    if (!content) continue;
    const lines = content.split('\n');
    if (lines.length < 120) continue;
    const headings = lines.filter(l => /^#{1,6}\s/.test(l)).length;
    const density = headings / lines.length;
    if (density < 0.03) {
      findings.push(finding(6, 'low', file,
        `${lines.length} lines, low heading density (${(density * 100).toFixed(1)}%) — likely verbose prose`,
        'Tighten wording (run with --prose) or split into digests'));
    }
  }
}

/**
 * analyze — collect files, run every lever check, return findings + grade.
 * Shared with estimate (review-driven flagged levers). No printing.
 */
function analyze(targetDir, home) {
  _targetDir = targetDir;
  _home      = home;
  const findings = [];
  const allCommandFiles = [];
  const collect = (filePaths) => { for (const f of filePaths) allCommandFiles.push({ file: f, content: readText(f) }); };
  collect(globMdFiles(path.join(targetDir, '.claude', 'commands')));
  collect(globMdFiles(path.join(targetDir, '.claude', 'agents')));
  collect(globSkillFiles(path.join(targetDir, '.claude', 'skills'), 'SKILL.md'));
  collect(globMdFiles(path.join(home, '.claude', 'commands')));
  collect(globMdFiles(path.join(home, '.claude', 'agents')));
  collect(globSkillFiles(path.join(home, '.claude', 'skills'), 'SKILL.md'));
  const projClaude   = path.join(targetDir, 'CLAUDE.md');
  const globalClaude = path.join(home, '.claude', 'CLAUDE.md');
  if (fs.existsSync(projClaude))   allCommandFiles.push({ file: projClaude,   content: readText(projClaude) });
  if (fs.existsSync(globalClaude)) allCommandFiles.push({ file: globalClaude, content: readText(globalClaude) });

  const { rows: overheadRows, perSpawnTotal } = checkLever6(targetDir, home, findings);
  checkLever1(allCommandFiles, findings);
  checkLever2(allCommandFiles, findings);
  checkLever3(allCommandFiles, findings);
  checkLever4(allCommandFiles, findings);
  checkLever5(targetDir, allCommandFiles, findings);
  checkLever7(allCommandFiles, findings);
  checkLever8(targetDir, home, allCommandFiles, findings);
  checkVerbose(allCommandFiles, findings);

  const projectFindings = findings.filter(f => f.scope === 'project');
  const hasProjectArtifacts = fs.existsSync(projClaude) || fs.existsSync(path.join(targetDir, '.claude'));
  const grade = hasProjectArtifacts ? computeGrade(projectFindings) : 'N/A';
  return { findings, projectFindings, allCommandFiles, overheadRows, perSpawnTotal, grade };
}

async function runReview(opts = {}) {
  const targetDir = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const home      = os.homedir();

  const { findings, projectFindings, allCommandFiles, overheadRows, perSpawnTotal, grade } = analyze(targetDir, home);
  const globalFindings = findings.filter(f => f.scope === 'global');

  // Detect whether any project-level Claude Code artifacts exist
  const hasProjectArtifacts = fs.existsSync(path.join(targetDir, 'CLAUDE.md')) || fs.existsSync(path.join(targetDir, '.claude'));

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
    return;
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

  console.log('─'.repeat(72));
  console.log('This is a STATIC design review (no usage history needed).');
  console.log('For measured usage, run `token-diet audit/diagnose` after sessions.');
  console.log('Execute fixes with the token-diet agent (`/token-diet`).');
  console.log('');
}

module.exports = { runReview, analyze, LEVER_NAMES, modelTier };

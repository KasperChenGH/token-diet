'use strict';
/**
 * digest.js — Lever 5 (tier the knowledge) prototype: the deterministic half.
 *
 * Dogfood rule: scripts compute, LLM judges. This module does the COMPUTE —
 *   1. find which files an agent re-reads (the digest candidates) from transcripts,
 *   2. measure the tokens spent re-reading them,
 *   3. extract a deterministic structure skeleton (signatures + headings) per file.
 * The JUDGE — turning each skeleton into a tight prose summary — is left to an agent.
 * A digest is a MOVE, not a delete: the full file stays; readers point at the digest.
 */
const fs   = require('fs');
const path = require('path');
const { scanAll } = require('./scan');

const fmt = n => Math.round(n).toLocaleString('en-US');

// A declaration/signature line (matches Read output with or without a line-number prefix).
const SIG_RE  = /^(?:\s*\d+[\t→|:]\s?)?\s*(export\s+)?(async\s+)?(def|function|class|func|fn|interface|type|struct|impl|module|public|private|protected)\b/;
const HEAD_RE = /^\s{0,3}#{1,6}\s+\S/;   // markdown heading

/** Deterministic structure extract: keep headings + declaration signatures, drop bodies. */
function extractSkeleton(text, opts = {}) {
  const max = opts.max || 120;
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  for (const ln of lines) {
    if (HEAD_RE.test(ln) || SIG_RE.test(ln)) kept.push(ln.replace(/\s+$/, ''));
    if (kept.length >= max) { kept.push(`  … (skeleton truncated at ${max} entries)`); break; }
  }
  return kept.join('\n');
}

/**
 * Group Read tool calls across all matched transcripts by file_path.
 * Joins each file's tool_results (which carry result_tokens) to its tool_use
 * registry (which carries the Read's file_path). Returns [{file, count, tokens}] desc.
 */
async function collectReadStats(opts = {}) {
  const { fileMeta } = await scanAll(opts);
  const byFile = new Map();
  for (const meta of fileMeta.values()) {
    const calls = meta.toolCallsById || new Map();
    for (const r of meta.toolResults || []) {
      const tc = calls.get(r.tool_use_id);
      if (!tc || tc.name !== 'Read') continue;
      const fp = (tc.input && (tc.input.file_path || tc.input.path)) || null;
      if (!fp) continue;
      const e = byFile.get(fp) || { file: fp, count: 0, tokens: 0 };
      e.count++; e.tokens += r.result_tokens || 0;
      byFile.set(fp, e);
    }
  }
  return [...byFile.values()].sort((a, b) => b.tokens - a.tokens);
}

/** Write a deterministic skeleton digest beside the project for a hot file.
 *  Returns the digest's project-relative path, or null (file gone / outside root). */
function scaffoldOne(root, cand) {
  let src; try { src = fs.readFileSync(cand.file, 'utf8'); } catch { return null; }  // file gone — skip
  const rel = path.relative(root, cand.file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;   // outside the project — can't place a digest
  const skeleton = extractSkeleton(src);
  const dir = path.join(root, '.claude', 'digests');
  fs.mkdirSync(dir, { recursive: true });
  const name = rel.replace(/[\\/]/g, '__').replace(/[^\w.-]/g, '_') + '.md';
  const body =
    `# Digest: ${rel}  (auto-skeleton — replace with a tight prose summary)\n\n` +
    `> Source: \`${rel}\` · read ${cand.count}× (~${fmt(cand.tokens)} tok over the window).\n` +
    `> This is a deterministic structure extract. An agent should rewrite it into a tight\n` +
    `> summary (≤ ~600 tok) capturing what a reader needs, then point readers here instead\n` +
    `> of re-reading the full file. The full file stays — this is a move, not a delete.\n\n` +
    `## Structure (extracted signatures / headings)\n\n` +
    '```\n' + (skeleton || '(no signatures detected — summarize by hand)') + '\n```\n';
  fs.writeFileSync(path.join(dir, name), body);
  return path.join('.claude', 'digests', name).split(path.sep).join('/');
}

const shorten = fp => fp.split(/[\\/]/).slice(-3).join('/');

async function runDigest(opts = {}) {
  const minReads = opts.minReads != null ? +opts.minReads : 3;
  const root = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const stats = await collectReadStats(opts);
  const hot = stats.filter(s => s.count >= minReads);

  if (opts.json) { console.log(JSON.stringify(hot, null, 2)); return hot; }

  if (!hot.length) {
    console.log(`\nNo files read ≥ ${minReads}× in the window — nothing worth a digest.`);
    console.log(`(Lever 5 targets files re-read many times. Widen with --days N or lower --min-reads.)\n`);
    return hot;
  }

  console.log(`\n=== Lever 5 — read-digest candidates (files read ≥ ${minReads}×) ===\n`);
  console.log('  reads |   tokens | file');
  console.log('  ------+----------+------------------------------------------------');
  for (const s of hot.slice(0, 25))
    console.log(`  ${String(s.count).padStart(5)} | ${fmt(s.tokens).padStart(8)} | ${shorten(s.file)}`);
  const addressable = hot.reduce((a, s) => a + s.tokens, 0);
  console.log(`\n  ${fmt(addressable)} tokens spent re-reading these ${hot.length} files (token ≈ chars/4).`);
  console.log('  A digest replaces repeat full reads with one tight summary — the Lever 5 win.');

  if (opts.scaffold) {
    console.log(`\nScaffolding deterministic skeletons under .claude/digests/ …`);
    let n = 0;
    for (const s of hot) {
      const rel = scaffoldOne(root, s);
      if (rel) { n++; console.log(`  wrote ${rel}`); }
    }
    console.log(`\n${n} skeleton(s) written. Now have an agent turn each into a tight prose digest`);
    console.log('(scripts found + measured + extracted structure; the agent writes the summary).\n');
  } else {
    console.log('  Re-run with --scaffold to write skeleton digests you (or an agent) then summarize.\n');
  }
  return hot;
}

module.exports = { runDigest, collectReadStats, extractSkeleton, scaffoldOne };

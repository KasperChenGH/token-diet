# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Lever 8 build-output compressor** — `compressBuild` + a `build` classifier for
  `npm` / `cargo` / `docker` / `tsc` / `eslint` output: keeps errors, warnings and the
  final summary; collapses per-package / per-layer progress; preserves eslint/tsc
  file-path headers (−86% on the bundled `--self-test`).
- **Lever 5 read-digest prototype** — `token-diet digest` finds the files an agent
  re-reads from your transcripts, measures the re-read token cost, and `--scaffold`
  writes deterministic structure skeletons under `.claude/digests/` for an agent to
  summarize (scripts compute, LLM judges; a digest is a move, not a delete).
- Continuous integration (GitHub Actions, now incl. a Windows runner + shebang check),
  a tag→version release workflow, `CODE_OF_CONDUCT.md`, and this changelog.

### Fixed
- **`dedupLog` no longer elides error/warning lines from the middle** — auditing real
  shell logs found it silently dropped a critical line (Python tracebacks, `FutureWarning`,
  `FAIL`) in **14% of elided calls**; the log compressor now always keeps error/warning
  lines in the elided middle (down to ~0% real loss, for ~1% less compression).
- **`compressTests` keeps Pester `[-]` failures** — a failing PowerShell/Pester test with a
  neutral name (no "fail" word) had its `[-]` line and `Expected …` detail collapsed; `FAIL_RE`
  now matches the `[-]` marker. Caught by replaying real Pester output.
- **filter never drops a failure line again** — `FAIL_RE` now matches `✖` (the glyph
  `node --test` uses, which token-diet itself runs) and TAP `not ok`; a real
  signal-preservation gap caught by replaying live tool output. Plus a batch of
  review-board fixes: no-id dedup double-count, post-strip `--report` accuracy, ReDoS
  guard on `keep` regexes, atomic state writes, `fix` path-traversal guard + region
  bounds, and corrected `review`/`overhead`/`--fail-under` documentation.
- Signal-preservation test corpus (`test/corpus.test.js`) distilled from real
  node:test / pytest / cargo / npm output, asserting no error/warning line is collapsed.

### Changed
- **Lever 5 (digest) is now first-class in the agent flow** — the analyst runs
  `token-diet digest --scaffold` when hot re-read files are flagged (the biggest token
  pool: 93% of read volume is re-reads), the digester turns the scaffolds into prose
  digests, and the analyst now asserts every specialist verdict lands (or flags it skipped).
  Demonstrated end-to-end: a real 775-line file → 625-token digest, −92% per reference read.
- **README repositioned** around *token observability + structural diagnosis* (the real
  savings); the output filter is framed as the automatic quick-win, not the headline.
- Documented the Claude Code transcript-format dependency as an ADR in `src/scan.js`.
- **Default now compresses both shells — Bash _and_ PowerShell** (incidental verbose
  output, like Bash). The git classifier now catches `cd … && git`, `git -C …`, and piped
  forms, and `Invoke-Pester` counts as tests. Task/Edit/Grep/Glob stay untouched.
- **Measured table corrected + recomputed.** A bucket audit found the old pooled numbers
  counted non-shell tools (Task subagent output, Edit, Grep, Glob) the default never
  compresses — inflating the "Bash total" call count ~2×. The table now reports the honest
  shell-only figure: **−69% across 379 calls** (git −81%, tests −86%, logs −63%) over eight
  codebases. Measurement scripts now enforce the `tools` allowlist so this can't recur.
- README rebuilt against a multi-expert authoring framework: value-prop hero,
  30-second working example up top, two-mode usage (Review / Auto), the measured reduction
  table, progressive disclosure of reference material, and an explicit "who it's for / not for".

## [0.7.0]

Baseline captured at the start of this changelog. Highlights of the engine and agent as
shipped:

### Added
- Three-tier `/token-diet` agent contract (orchestrator → analyst → nine lever specialists),
  each specialist deployed self-contained with its rubric + private knowledge inlined at install.
- The eight-lever methodology (`skills/SKILL.md`) with per-lever judgment rubrics.
- Lever 8 output-compression engine (`src/filter.js`, PostToolUse hook + sidecar),
  **safe by default**: audit mode, `keep`-patterns, Bash-only scope, measured `--report`.
- `token-diet setup` — one-command ongoing protection (filter in audit mode + a pre-commit
  drift reminder) and `review --fail-under <grade>` as a CI/commit gate.
- Zero-dependency CLI: `review · estimate · audit · agents · diagnose · overhead · plan ·
  fix · filter · digest · compare · init · setup`, reading real Claude Code transcripts with
  per-`requestId` dedup.

[Unreleased]: https://github.com/KasperChenGH/token-diet/compare/v0.7.0...HEAD

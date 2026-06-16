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
- **filter never drops a failure line again** — `FAIL_RE` now matches `✖` (the glyph
  `node --test` uses, which token-diet itself runs) and TAP `not ok`; a real
  signal-preservation gap caught by replaying live tool output. Plus a batch of
  review-board fixes: no-id dedup double-count, post-strip `--report` accuracy, ReDoS
  guard on `keep` regexes, atomic state writes, `fix` path-traversal guard + region
  bounds, and corrected `review`/`overhead`/`--fail-under` documentation.
- Signal-preservation test corpus (`test/corpus.test.js`) distilled from real
  node:test / pytest / cargo / npm output, asserting no error/warning line is collapsed.

### Changed
- README rebuilt against a multi-expert authoring framework: value-prop hero,
  30-second working example up top, two-mode usage (Review / Auto), pooled measured
  reduction table (−65% Bash output across 824 calls over eight codebases), progressive
  disclosure of reference material, and an explicit "who it's for / not for".

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

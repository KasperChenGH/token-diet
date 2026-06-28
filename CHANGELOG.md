# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.1] - 2026-06-28

Refinements to the 0.11 line: one auto-mode behavior change plus a batch of fixes from two
self-review passes (a critical `compact` bug, cross-command number alignment, and doc accuracy).

### Fixed
- **`compact`'s intent was always empty (the feature was half-broken).** Two stacked bugs: `scanAll`
  dropped `firstUserText` when assembling `fileMeta`, and scan's fast pre-filter discarded the opening
  user prompt (a plain text line with no `usage`/`tool_result` marker). Relaxed the pre-filter to let
  early user-type lines through (bounded) and skip tag-wrapped command/meta. Intent now resolves for
  138/146 real sessions (was 0); locked with an end-to-end test through the binary.
- **Cross-command token math disagreed.** `plan` and `diagnose` estimated tokens with a flat `size/4`
  while `review`/`estimate` use per-extension ratios — the same file reported different counts across
  commands. All routes now use `collectors.charsPerToken` (uniform everywhere).
- **`diagnose` mis-bucketed PowerShell output** as a single row (only `Bash` was special-cased); now
  per-program, matching how `trace`/`filter`/`compact` treat the two shells.
- **`trace`'s context-pressure detector never fired** on real data — it measured proximity to a
  session's own peak, but heavy sessions sawtooth (compact → regrow). Redefined as the share of calls
  carrying a large context (compaction-agnostic); now flags real sessions correctly.
- **`review/checkToolSurface` ignored `~/.claude.json`** — the canonical store `claude mcp add` writes
  to; local MCP servers were silently missed. Added the scan.
- **Doc accuracy:** help said "Six" waste heuristics (it's seven); stale `#v0.9.1` README install pin
  → `#v0.11.0`; npm-page demo image pointed at a non-shipped path → absolute raw URL; `/token-diet
  status` now resolves a vendored CLI (was bare `token-diet`, which fails in project-scoped installs).
- **`estimate`** clamped an explicit "spawn N agents" count (a prose "500" no longer inflates the bill).

### Changed
- **Auto-mode is now one decision, not a checklist.** `token-diet setup` wires the *whole* background
  stack — the output filter (Lever 8) **and** the read-path gate (Lever 3) — in lockstep: plain `setup`
  puts both in AUDIT (records what they'd save, sessions unchanged); `setup --activate` brings both
  LIVE in one command. Previously `setup` wired only the filter and printed "now hand-install the
  readgate yourself" — which contradicted the point of a hands-off mode. The two hooks never go
  half-wired now. Both remain fully recoverable (full output kept on disk; gated files stay on disk),
  and `filter --disable` / `readgate --disable` turn either off. `route` and `trace` stay pointers —
  they are not background hooks, so there is nothing to "activate."

## [0.11.0] - 2026-06-28

Fill the **always-loaded-context** gaps a professionally-designed agentic workflow still leaves open
(from the context-engineering + harness research). Unlike `trace`'s behavioral diagnosis, every item
here attacks context that **re-sends every turn** — the 97.7% baseline the measurement isolated — so
the savings are structural, not behavioral.

### Added
- **`token-diet compact` — Lever 2 made executable.** A deterministic `{intent, artifacts, next-steps}`
  handover from a real session, so the next session resumes from a compact state doc instead of
  re-establishing context (the session-start re-exploration the harness research names). Intent = the
  captured opening prompt; artifacts = files Edited/Written + git commits; next-steps = the last
  TodoWrite's open items — all extracted deterministically (scripts compute), the model only refines
  wording. `--session <id>` (default: most recent), `--out <file>`.
- **`review` — three new static checks** against patterns the size-based review missed:
  - **Tool-surface bloat (Lever 8):** counts MCP servers / exposed tools (`.mcp.json`, settings) and
    flags agents with over-broad `tools:` frontmatter (`*` or ≥10) — each enabled tool's schema is
    per-turn context.
  - **Prompt quality / altitude (Lever 6):** flags always-loaded files that encode control flow in
    prose — many `if/else` directives, long edge-case bullet runs, or redundant example blocks.
  - **Knowledge duplication (Lever 5):** exact normalized-paragraph match across always-loaded files; flags
    blocks repeated in 2+ files (each copy re-sends every turn).
- **`trace` — context-pressure detector (Lever 3):** flags sessions that held a near-full context for
  most of the run (peak cache_read + sustained near-full share), reported separately from MEASURED /
  PROJECTED, never summed.

### Notes
- JIT/eager-loading and verification/rework gaps were assessed and found **already covered** —
  `checkLever5` (no-digest reference dirs + "read all" bulk-loads) and `detectRetries` (repeated
  failures) respectively. Building separate detectors would re-flag the same files / fire on normal
  iteration, so they were deliberately **not** duplicated (token-diet's own "don't duplicate" rule).

## [0.10.0] - 2026-06-28

A new **behavioral** diagnosis pillar — the dynamic counterpart to the static `review`. (Honest
framing: this is a *diagnostic*, not a savings feature — see the note below.)

### Added
- **`token-diet trace` — behavioral waste from real transcripts.** MEASURED (Lever 3): action loops
  (≥3 consecutive fuzzy-identical retrieval calls, results-gated; mutating/task tools excluded) +
  retry streaks, compounded through cache_read until the next compaction boundary (detected as a
  cache_read drop). PROJECTED (Lever 1, bidirectional): delegation-fit — exploration clusters in the
  main session that a subagent should isolate, + over-delegated tiny subagents. Token-diet-native
  waste model (real tokens × compounding re-send), not the academic coefficient WCR.
- **Cross-file knowledge-duplication finding (Lever 5)** in `review` — the same block in 2+
  always-loaded files (loaded once per-file × every spawn).
- **Auto-mode surface:** `savings` now reports behavioral waste with a nudge; `setup` points to `trace`.
- `scan` exposes tool_use `id` + tool_result `is_error` (the single coupling point gains what trace needs).

### Note (measure, don't cite)
Measured on ~1.5B real tokens, behavioral waste is **< 0.03% of volume** — **97.7% is legitimate
cache_read** (context re-sending every turn). `trace` is a diagnostic that tells you where waste is
*and isn't*; the headline savings still come from the static levers that shrink the re-sending
baseline (Levers 5/6/8).

## [0.9.1] - 2026-06-25

Post-`v0.9.0` hardening from a packaging audit + a senior-engineer / product-manager review.
No new features; correctness, structure, packaging, and docs.

**First npm release** — published as **`token-diet-cli`** (npm's name guard blocks the bare
`token-diet`, which is too similar to an existing package). The installed CLI command is still
`token-diet`. Install: `npm i -g token-diet-cli`.

### Fixed
- **`bin` path** — `"./bin/token-diet.js"` → `"bin/token-diet.js"`. npm 11 rejects the leading
  `./` and strips the bin entry on publish, which would ship a package with no `token-diet` command.
- **License detection** — removed a UTF-8 BOM from `LICENSE` so GitHub/licensee detect it as MIT.

### Changed
- **`scan.js` streaming fallback** — files over 64 MB stream line-by-line (bounded memory) instead
  of buffering whole; a parity test proves byte-identical records to the buffered path.
- **Split `review.js`** (was the largest module) — the renderer moved to `src/review-render.js`
  (analysis vs presentation), with a one-way module edge (no circular require).
- **Packaging metadata** — added `author`/`homepage`/`bugs`/`publishConfig`; `repository` →
  `git+https`; dropped the misleading `main`. Added a provenance publish workflow (OIDC).

### Added
- Community-health set: `SECURITY.md` (private vuln reporting), `CONTRIBUTING.md`, issue + PR
  templates. Tests for the `agents` useful-work ratio / 0.15 flag and the streaming path.
- Named the `chars/4` approximation; `@typedef Record` documenting the transcript-schema contract;
  targeted JSDoc on the public decision functions.

### Docs
- README: tightened the hero, surfaced the privacy line above the fold, added an "all numbers are
  self-measured" disclaimer, de-duplicated the filter lifecycle and the per-lever vs measured tables,
  and noted GitHub-only distribution. README is now ~274 lines (was 303).

## [0.9.0] - 2026-06-25

Closes the remaining competitive-survey backlog: the Tier-1/2/3 optimization opportunities
and the two open questions (double-counting attribution; the unserved MCP-output category).

### Added
- **`route` — Lever 7 model-arbitrage router.** Turns Lever 7 from advice into a runnable
  artifact: a deterministic, ordered, first-match-wins rule table maps a task description to a
  model tier (haiku|sonnet|opus). A high-stakes guard rule is first, so architecture / security /
  production / migration / root-cause / synthesis always pin to opus and can't be undercut by a
  mechanical keyword. Routing is asymmetric — down only when confident; anything unmatched defaults
  to opus and is flagged `escalate`. Not a learned router; the editable `.claude/router/rules.json`
  is the product. `--classify "<task>"` / `--scaffold` / `--self-test`.
- **`burn` — billing-window / burn-rate view.** Buckets recent activity into epoch-aligned 5-hour
  blocks (the usage-limit reset unit), shows raw + price-weighted tokens per block, and projects the
  current block to its reset. Documents reconciliation with ccusage.
- **Lever 8 listing rubric.** A `list` compressor for directory output (`ls -R`/`tree`/`find`/`du`/
  `Get-ChildItem`): head+tail + a count, never eliding error/permission lines.
- **MCP-output filtering (owns the unserved category).** Tool names matching `mcp__` route to a new
  `mcp` filter kind (structural JSON crush for JSON bodies, `dedupLog` otherwise), reported as its own
  row. The filter allowlist gains a trailing-`*` glob (`mcp__*`) so one entry gates every server.

### Changed
- **Calibrated token model.** Replaced the flat bytes/4 with per-extension chars/token ratios
  (.md 4.2, code 3.8, .json 3.2) and added vendor policy constants `OFFLOAD_TOKENS` (20k),
  `CONTEXT_WINDOW` (200k), `TRUNCATE_AT_PCT` (0.85). `review` now flags any always-loaded file over
  the 20k offload threshold; `review` and `collectors` share one `estTokens` (DRY).
- **Move-not-delete stub is a pointer + preview.** Lever 6 moves leave a path pointer plus a 5-line
  preview of the evicted content, not a bare reference.
- **Attribution guard (Open Q1).** Overlapping gates (filter, readgate, native context-editing)
  reduce the same token pools; `savings` now prints a do-not-sum caveat when multiple gates have
  measured activity, and Lever 3 documents the attribution rule.

### Docs
- Lever 2 living-doc `{intent, artifacts, next-steps}` summary schema; Lever 3 eviction vocabulary;
  Lever 5 compression-literature evidence; README positions token-diet above observability tools.
- Re-measured the output-filter corpus to **~389 shell calls across twelve codebases** (the README
  "Measured reduction" figures trace to this run; the prior 0.8.0 note cited 379 calls / eight
  codebases). Added a `route`/`burn`/`readgate` entry to the project-layout subcommand list.

## [0.8.0] - 2026-06-25

### Added
- **`readgate` — read-path dedup (Lever 3).** A PreToolUse hook on `Read` that detects within-session
  re-reads of an *unchanged* file+range and (in active mode) denies them with a recoverable reason —
  the full file stays on disk, so a denied read is never data loss. Off by default, audit-first, never
  auto-activated. Lifecycle mirrors the output filter: `--install`/`--self-test`/`--enable` (audit)/
  `--activate` (live)/`--report`/`--disable`/`--uninstall`. It is the read-path twin of the Lever 8
  output filter (which compresses *command* output). Savings are **measured, not claimed**: the figure
  comes from a committed deterministic replay benchmark (`test/readgate.test.js`) and from the user's
  own `readgate --report` — no external/borrowed percentages are published.
- **JSON output compressor (Lever 8).** A new `json` content kind: shell output that parses as
  JSON (curl/jq/`--output json`/API responses) is now shrunk *structurally* — long arrays
  truncated to head+tail+count, long string values clipped, re-serialized compact — while every
  key and all `error`/`status`/`message` values are preserved. Validated on real output: **−41%**
  on `npm view react` (80k tok) to **−95%** on array-heavy API responses. Content-based routing
  (the command alone is too varied), fail-safe to `dedupLog` on non-JSON. Also switched the
  filter's no-gain guard from line-count to **token-count** (compact JSON is one line). Inspired by
  [headroom](https://github.com/chopratejas/headroom)'s SmartCrusher, kept zero-dependency.
- **Project-scoped install needs no global binary.** `token-diet init` (project mode) now
  **vendors the zero-dependency CLI into `.claude/token-diet/`**, so the agent and the pre-commit
  drift gate run via `node .claude/token-diet/bin/token-diet.js` — no global install, no npx, no
  PATH, in any project type (incl. Python). The pre-commit hook auto-resolves whichever exists:
  vendored project copy → global → `node_modules` → `npx`. `init --global` is unchanged (no
  vendoring; relies on the global binary). Global and project modes are fully separate — your pick.
- **Structural-drift detection** — structural waste regrows as you work, so a one-time
  `/token-diet` decays. `setup` now records a **drift baseline** (your grade), and `review`
  (run by the pre-commit gate on every commit) nudges loudly if the grade regressed *since your
  last token-diet run* — so you re-optimize when told, not on a guess. `review --record` stamps
  the baseline (the agent's Phase 5 uses it); detection is automatic, the fix stays gated.
- **`token-diet setup --activate`** — one-command path to the auto filter: wires the hook AND
  goes live immediately (skip the audit preview). Default `setup` still starts in audit; the
  agent never auto-activates. README Mode 2 rewritten so the minimal path (one command + reload)
  is obvious and the audit-preview is clearly the optional, cautious alternative.
- **`token-diet savings`** — per-lever / per-section token-reduction table (structural levers
  projected from `estimate`; output filter measured from real stats), auto-printed at the end of
  the agent's Phase 5. **`--share`** builds a strictly aggregate-only report (version, OS, anon
  install id, grade, projected/measured reduction % — no paths, names, commands, or content) and
  prints a pre-filled GitHub issue link the user opts into submitting; `--dry-run` previews the exact
  payload; nothing is sent unless `--share` is run (or you set `TOKEN_DIET_TELEMETRY_URL`).
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

### Performance
- **Faster transcript scanning (byte-identical output).** The CLI measurement path
  (`audit`/`agents`/`diagnose`/`compare`/`plan`) was re-profiled on a real ~459 MB / 1,119-file
  corpus and made markedly leaner without changing a single computed number: (1) **file-level
  `--days` window-skip** — files whose mtime predates the cutoff (minus a 24h skew) are skipped
  without opening (append-only transcripts can't hold newer records); (2) **bounded-parallel
  reads** across files; (3) a **substring pre-filter** that skips `JSON.parse` on lines lacking
  `"usage"`/`"tool_result"` (~58% of lines in a real 97 MB session); (4) **bulk async read** in
  place of `readline` (~25% faster on large files). `compare` now scans **once** and buckets by
  window instead of re-implementing the scan and parsing every file twice. Determinism is
  preserved (records reassembled in collection order); verified byte-identical on real data.
- **Leaner filter hot path.** `token-diet filter` (the PostToolUse hook, a fresh process per
  Bash/PowerShell call) now **lazy-loads only `filter.js` + `atomic.js`** instead of eagerly
  requiring all 13 subcommand modules and their transitive graph — trimming per-call startup.

### Fixed
- **Lever 5 digests now actually get read (routing).** Creating a digest saved nothing if the agent
  kept reading the full file. `digest --scaffold` now writes `.claude/digests/INDEX.md` and prints a
  one-line CLAUDE.md pointer; `/token-diet` adds that pointer as a changeset item — so future reads
  route to the digest and `token-diet compare` can measure the realized drop. Digester is folded into
  the agent end-to-end (no manual run) and capped at a **hard ≤600-token budget** (it overshot before).
  README corrected to the real deployed-subagent result: **−77% per reference read** (was a −92% hand-demo).
- **Pre-commit hook upgrades in place.** `setup` now detects a stale (pre-vendoring) single-line
  drift hook and rewrites it to the smart resolver (vendored → global → node_modules → npx),
  preserving any foreign hook content — so a project that ran `setup` on an older version picks up
  the project-scoped fallback instead of silently skipping when there's no global binary.
- **`savings --share` warns before the link.** It now prints "this opens a PUBLIC GitHub issue"
  *at the moment of action*, not just in the README, so no one submits without realizing it's public.
- **`digest --scaffold` is now one-paste-finishable.** Each scaffold is a ready-to-use authoring
  prompt: paste it into any LLM (or run `/token-diet`, whose digester subagent does it automatically)
  and drop the output into the file's `Digest` section. token-diet still never calls an LLM itself.

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
  Measured end-to-end: the deployed digester turned a real 321-line file → a 740-token digest,
  −77% per reference read (see the later "Fixed" entry — this supersedes an earlier hand-demo).
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

[Unreleased]: https://github.com/KasperChenGH/token-diet/compare/v0.11.1...HEAD
[0.11.1]: https://github.com/KasperChenGH/token-diet/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/KasperChenGH/token-diet/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/KasperChenGH/token-diet/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/KasperChenGH/token-diet/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/KasperChenGH/token-diet/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/KasperChenGH/token-diet/releases/tag/v0.8.0

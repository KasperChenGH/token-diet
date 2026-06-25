# token-diet

[![CI](https://github.com/KasperChenGH/token-diet/actions/workflows/ci.yml/badge.svg)](https://github.com/KasperChenGH/token-diet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2018-brightgreen.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

> **Token observability for your AI agents — read your real transcripts, see where the architecture wastes tokens, and restructure it.**

Agentic pipelines burn tokens *structurally* — too many helper agents, instruction files reloaded every step, results recomputed, verbose output re-sent every turn — because of *how they're built*, not *what they say*. **token-diet** is a Claude Code agent + CLI + skill that measures where your tokens actually go (from real usage logs, not estimates), sorts the waste into **8 levers**, and fixes it — moving content to references, never deleting.

**Runs entirely on your machine — reads your local transcripts, sends nothing. Zero dependencies.** The set-and-forget output filter alone cuts a [self-measured](#measured-reduction) **−69%** of shell output; the bigger win is structural.

It eats its own dogfood — ***scripts compute, LLM judges***: the CLI does every measurement and applies every edit mechanically; the model is used only for keep-or-trim judgment calls.

## Try it in 30 seconds

No agent install and no usage history needed — grade any project's Claude Code design against all 8 levers:

```bash
npm install -g github:KasperChenGH/token-diet
token-diet review --dir .
```
```
Lever 1  Delete ceremonial agents   5 findings  med
Lever 4  Scripts for determinism    2 findings  high
Lever 7  Model arbitrage            1 finding   high
Grade: F
```

*(Abbreviated — the real output lists all 8 levers with per-finding evidence and an overhead snapshot.)* `review` reads no history and **changes nothing** — it grades your `.claude/` design (CLAUDE.md, commands, agents, skills) A–F and tells you how to cut tokens before you've spent one.

## Install the agent — global or project-scoped (your choice)

> **Distribution:** token-diet is installed straight from GitHub (it's not on the npm registry) — the `github:KasperChenGH/token-diet` form below is intentional, not a typo. Pin a release with `#v0.9.0`.

The CLI is the engine; the `/token-diet` agent drives it. Pick the scope that fits — they're fully separate, and **project-scoped needs no global install at all**:

**A) Global** — one install serves every project on the machine (best for polyglot setups):

```bash
npm install -g github:KasperChenGH/token-diet   # the CLI, on your PATH
token-diet init --global                        # agent + subagents + command + skill → ~/.claude/
```

**B) Project-scoped — fully self-contained, no global anything** (works in any project, including non-Node like Python):

```bash
npx github:KasperChenGH/token-diet init   # one-shot: vendors a zero-dep CLI copy into ./.claude/token-diet/
                                          #           + installs the agent into ./.claude/
```

In project mode, `init` **vendors the whole (zero-dependency) CLI into `.claude/token-diet/`**, so the agent and the pre-commit drift gate run it via `node .claude/token-diet/bin/token-diet.js` — no global binary, no `npx` per call, no PATH. The pre-commit hook auto-resolves whichever you have: **vendored project copy → global → `node_modules` → `npx`**.

Either way, reload Claude Code, then run **`/token-diet`** (or just say *"put this project on a token diet"*).

> The project `.claude/` files (artifacts **and** the vendored CLI) are plain text — **commit** them to give your whole team the exact same setup with zero install, or **gitignore** them to keep it personal. Global vs. project is decided purely by whether you pass `--global` to `init`.

## How to use it — two modes

**Start with Mode 1** — the structural review is where the real savings are. **Mode 2** (the output filter) is an automatic quick-win you can also leave running, but on its own it's the smaller pool. Most people do the review once, then keep the filter on. A companion read-path gate (`token-diet readgate`) does the same for redundant *file re-reads* within a session — off by default, audit-first, measured via `readgate --report`.

### Mode 1 · Review — `/token-diet`  (full control)

Run the agent. It **measures** your real token usage, **finds** the structural waste (sorted into the 8 levers), and **shows you a plan** with the expected savings — then **stops**. Nothing in your project changes until you approve (reply *approve all*, *approve 1,3*, or *none*), and every applied change is a **move, never a delete**. This is the mode for the big structural wins, where you want to see each trim before it lands.

### Mode 2 · Auto — `token-diet setup`  (set-and-forget)

**The problem it fixes:** noisy command output — a test run, a `git diff`, a build log — gets re-sent to the model on *every* later turn, quietly inflating your bill. Auto mode runs a filter that compresses that output the moment it appears, so the bloat never piles up. Nothing to review — it just works in the background.

**Fastest — one command, then reload:**

```bash
token-diet setup --activate   # wires the filter AND turns compression on
# → reload Claude Code — it now compresses verbose tool output automatically
```

That's the whole thing — set-and-forget once active. The full original output is always kept in `.claude/toolout/` so nothing is ever lost, and you can `token-diet filter --disable` anytime.

**Prefer to preview first?** Run `token-diet setup` without `--activate` — it wires the filter in **audit** (watch-only) mode, changing nothing; check `token-diet filter --report` to see what it *would* cut, then `token-diet filter --activate` when you're happy.

<details>
<summary>Bonus: <code>setup</code> also catches structural <b>drift</b> over time</summary>

Structural waste *regrows* as you work — you add an agent, CLAUDE.md creeps up, new files get re-read — so a one-time `/token-diet` decays. You shouldn't have to *remember* to re-run it. So `setup` records a **drift baseline** (your current grade) and drops a git pre-commit hook (`token-diet review --dir .`) that re-grades on every commit. If the grade **regresses since your last token-diet run**, the commit prints one loud line — *"⚠ Structural drift: grade regressed B → C … run /token-diet to re-optimize"* — otherwise it stays quiet. So you re-optimize **when told**, not on a guess. (Add `--fail-under C` to the hook line to **block** the commit instead of warning.)

The fix itself stays manual by design: re-optimizing means an LLM editing your files with judgment, so it always goes through `/token-diet`'s approval gate. token-diet auto-*detects* the drift; you approve the *fix*.
</details>

<details>
<summary><b>Manual CLI</b> — the individual steps the two modes wrap (for power users)</summary>

```bash
# MEASURE — where do tokens actually go?
token-diet audit   [--days 7] [--project myapp]   # usage by session-kind × model + heaviest sessions
token-diet agents                                  # useful-work ratio per agent; flags READING NOT THINKING

# DIAGNOSE — what structural waste exists?
token-diet diagnose                                # red flags mapped to levers
token-diet digest                                  # Lever 5: files an agent re-reads, with their token cost

# ACT — turn findings into work
token-diet plan --out diet-plan.md                 # ordered checkbox plan per lever with evidence + savings
token-diet route --classify "rename a symbol"      # Lever 7: route a task to a model tier (--scaffold the rules)
token-diet readgate --install                      # Lever 3: PreToolUse read-dedup hook (audit-first)
token-diet init [--global]                         # install the agent + subagents + command + skill

# VERIFY — did it work?
token-diet compare --before-days 14 --after-days 7 # per-day deltas across windows; the re-measure bookend
token-diet burn                                    # 5-hour billing-block view + current-block burn projection
token-diet savings                                 # per-lever/section reduction table; --share for opt-in feedback
```

Usage is deduplicated per API request (`requestId`) — Claude Code writes 2–3 transcript lines per call with repeated usage; naive summing inflates totals ~2–3×. This tool counts each call once. The CLI `review` is **entirely static** — regex + file-size heuristics, no LLM, no history, returns in milliseconds. LLM judgment (the Sonnet lever specialists, deployed self-contained with inlined rubrics) happens in the **`/token-diet` agent's** review phase, not in the `review` command.
</details>

## The 8 levers (the methodology)

In leverage order — each shrinks the next:

1. **Delete agents** — every spawn must buy parallelism, isolation, or model-arbitrage worth more than its ~20–40k establishment tax
2. **Merge sessions** — one per cycle; state in files, never conversations
3. **Evict compute** — long commands run in drivers between sessions: zero tokens
4. **Scripts compute, LLM judges** — deterministic kernels emit conclusions
5. **Tier the knowledge** — living doc → digests → archive (`token-diet digest` finds the candidates)
6. **Trim the always-loaded** — every spawn pays for it
7. **Model arbitrage** — big model only where judgment lives
8. **Filter tool output** — verbose test/build/log stdout compressed at the source, never re-sent every turn

### Estimated saving per lever

These are **different mechanisms in different units** — don't read them as one stackable %. Each row marks its **basis**:

- *measured* — real data
- *demonstrated* — a worked example
- *model* — a forward projection from `token-diet estimate` (run it for your own numbers)
- *restructure* — project-specific, not token-modeled

| Lever | Typical saving | Basis |
|---|---|---|
| 1 · Delete agents | ~20–40k tokens per **removed ceremonial spawn** | model |
| 2 · Merge sessions | one cycle's re-sent context per merge | restructure |
| 3 · Evict compute | the idle / compute-adjacent tokens of babysat commands | restructure |
| 4 · Scripts compute | halves the LLM's re-derivation (output ×0.5) — **~−3k weighted tok/run** on a representative project | model |
| 5 · Tier knowledge (digests) | a digest replaces N repeated full reads → see *Measured reduction* | measured + model |
| 6 · Trim always-loaded | reference bulk → a pointer: **−80% of the always-loaded file**, **× every spawn** (the largest compounding saver) | demonstrated |
| 7 · Model arbitrage | **$-cost only** — `token-diet route` classifies each task to the cheapest safe tier (not raw tokens) | model |
| 8 · Filter tool output | verbose tool output compressed at the source → see *Measured reduction* | measured |

- **Lever 6** — `subagent-context-trimmer` cut a representative `CLAUDE.md` from **524 → 104** always-loaded tokens (moved the reference bulk — script catalog, definitions, layout — to a pointer + companion file).
  - **−80% of what every spawn pays**, compounding to **−4,200 tok/round at 10 agents**.
  - Move-not-delete; the moved content loads on demand.

- On a representative heavy project, `estimate` projects **−41% of the per-run bill** from the flagged levers combined (top savers: L6, L1, L4).
- Project-specific — run `token-diet estimate --dir .` for your projection, `token-diet compare` for the measured result.
- **Bookends:** measure first (this CLI), re-measure + adversarial consistency review after. Full methodology with red flags and common mistakes: **[SKILL.md](skills/SKILL.md)**.

## Measured reduction

> **All numbers on this page are self-measured.** They come from the author's own corpus and from token-diet's own committed benchmarks/`--report` — **not** from an independent third party. They use a token≈chars/4 estimate, not API-billed tokens. Treat them as honest, reproducible-on-this-corpus figures, not a vendor guarantee — and **run `token-diet compare` / `filter --report` to get your own**.

Pooled across **twelve production codebases** (≈389 shell calls), counting only what the default filter actually compresses — **shell output (Bash + PowerShell)**, weighted by token volume (not a min–max over a few runs).

| tool output | what it keeps · what it collapses | reduction |
|---|---|---|
| **git** — `status` / `diff` / `log` | branch + changed files + diff hunks · unchanged-tree noise | **−83%** |
| **tests** — pytest / jest / cargo / go / Pester | failures, tracebacks, the pass/fail summary · passing runs | **−86%** |
| **JSON** — `curl` / `jq` / `--output json` / API | every key + error/status values · truncates long arrays, clips long strings | **−40%** |
| **logs / other** shell output | dedups repeats · head/tail-elides middles (errors/warnings always kept) | **−62%** |
| **shell total** — Bash + PowerShell (the safe default) | the rows above, blended | **−69%** |
| **builds** — npm / cargo / docker / tsc / eslint | errors, warnings, the final summary · per-package/layer progress | **−86…−98%** |
| **listings** — `ls -R` / `tree` / `find` / `du` *(v0.9)* | head + tail + a count · the bulk of entries (errors/permissions always kept) | **−50%** *(fixture; scales up)* |
| **MCP** — `mcp__*` server responses *(v0.9, opt-in)* | same structural crush as JSON for JSON bodies · dedup for prose | **−40…−95%** *(JSON engine)* |
| **file reads** — Lever 5, via `token-diet digest` | one authored digest replaces N repeated full reads | **−77%/read** (−42% blend is a projection) |

- Structured output compresses hardest (tests/git rival a specialized Rust command-rewriter's ~−80%); the blend is held down by free-form logs, which dominate the volume and have no schema to exploit. Low-call rows (tests, git, JSON) are lightly sampled.
- **Per-call, but compounding:** each compressed output is re-sent every later turn, so the real effect compounds through `cache_read` — your dominant cost. Measure the whole-session result with `token-diet compare`.
- **builds / JSON** vary by output: builds land **−86…−98%** on verbose tools (quiet-by-default ones show little); JSON lands **−40%** here but **−41% (`npm view react`) to −95%** on array-heavy API output. **listings / MCP** are new in v0.9 and *demonstrated, not pooled-measured* — real numbers populate from your own `filter --report`.
- **file reads** are a separate, opt-in, and far bigger pool: `subagent-digester` turned a real 321-line file into a **740-token digest** (**−77%/read, measured**; the −42% blend is a projection). `token-diet compare` gives your real multi-session number.

## The output filter — config & keep-patterns

The Lever 8 filter (turned on in **Mode 2** above) compresses **shell output — Bash + PowerShell — by default**; Read/Grep are opt-in (better handled by Lever 5 digests) and Task/Edit are left untouched. It is audit-first and the full original output is always kept in `.claude/toolout/<ts>.log` with a pointer, so nothing is lost.

<details>
<summary><b>keep-patterns &amp; config</b> — protect your own signals; tune thresholds (<code>.claude/toolout/filter.json</code>)</summary>

Generic rules can't know what matters in *your* output. Add regexes to `keep`; any matching line is **never** collapsed.

```json
{
  "enabled": true,
  "mode": "audit",
  "tools": ["Bash", "PowerShell"],
  "keep": ["WARNING", "DEPRECATION", "your-custom-marker"],
  "minTokensToCompress": 1500,
  "minLines": 60,
  "headTail": 20,
  "sidecarRetentionDays": 7
}
```

| field | meaning |
|---|---|
| `mode` | `audit` (record only, output unchanged) or `active` (compress for real) |
| `tools` | which tools to compress — `["Bash", "PowerShell"]` by default; add `"Read"`/`"Grep"` to opt in (then re-run `--install` to re-sync the hook matcher) |
| `keep` | regexes whose matching lines are never collapsed |
| `minTokensToCompress` / `minLines` | only compress output above this size; smaller output passes through untouched |
| `headTail` | head/tail lines kept when eliding an oversized middle |
| `sidecarRetentionDays` | prune full-output sidecar logs older than this |
</details>

## How it works

A **zero-dependency CLI** owns every deterministic step — real transcript measurement, overhead quantification (part of `review`), rule-based waste *detection*, the plan/changeset *skeleton*, mechanical edit *application*, and before/after re-measurement. The LLM is never asked to count, compute, or apply. (The one forward projection, `estimate`, is labelled a model — not a measurement.)

The `/token-diet` agent runs in **three tiers**: the orchestrator (runs as your session model — set it to Opus for synthesis-quality judgment) → an analyst (Sonnet) that measures, plans, and spawns specialists → **eight lever specialists** (Sonnet; Lever 6 adds an opt-in prose-auditor, so nine files in all) that each judge only their flagged files and return KEEP / MOVE / DISPOSE verdicts. Each specialist is deployed **self-contained**: `init` inlines its lever rubric + private professional knowledge + shared contracts into one file, because spawned subagents run in your project dir and can't read companion files at runtime.

<details>
<summary><b>Project layout</b></summary>

```
token-diet/
├── bin/token-diet.js              CLI entry — subcommands: review · estimate · audit · agents · diagnose ·
│                                  plan · fix · filter · readgate · route · digest · compare · burn · savings · init · setup
├── src/filter.js                  Lever 8 output-compression engine (PostToolUse hook)
├── src/digest.js                  Lever 5 read-digests: finds re-read files, scaffolds, routes (INDEX + pointer)
├── src/readgate.js                Lever 3 read-path dedup (PreToolUse hook)
├── src/router.js                  Lever 7 model-arbitrage rule-table router
├── src/*.js                       the deterministic engine (zero deps, no LLM): scan, collectors,
│                                  review, review-render, estimate, diagnose, plan, changeset, fix,
│                                  compare, burn, savings, history, …
├── skills/
│   ├── SKILL.md                   the 8-lever methodology (the main skill)
│   └── shared/                    knowledge shared across subagents (inlined on install)
├── agents/
│   ├── token-diet.md              tier-1 orchestrator (the /token-diet agent)
│   ├── subagent-analyst.md        tier-2 — measures, plans, spawns specialists, merges
│   └── subagent-<role>.md  ×9     tier-3 lever specialists
├── references/
│   ├── levers/lever-N-*.md  ×8    per-lever judgment rubrics
│   └── subagents/*.md       ×10   per-subagent extra professional knowledge
└── commands/token-diet.md         the /token-diet slash command
```
</details>

## Is token-diet for you?

- **Built for** teams running recurring or multi-agent **Claude Code** workflows — research loops, CI agents, review bots — where token cost or usage limits actually bite.
- **Not for** one-off single-prompt scripts where cost is a non-issue, or non–Claude-Code setups: token-diet reads Claude Code's usage transcripts and `.claude/` artifacts, so that's what it measures and optimizes.
- **Domain-neutral.** It works at the architecture layer; it was distilled from one project but is tied to none.

### token-diet sits *above* observability

Cost dashboards — **ccusage**, **Langfuse**, **Helicone** — tell you *what the bill is*. token-diet tells you *which agent, session, and lever to cut to lower it*, then restructures the workflow and re-measures. It's diagnosis + treatment, not a meter. Use a dashboard to watch spend; use token-diet to reduce it. (`token-diet burn` even speaks the dashboards' language — a 5-hour billing-block view reconcilable with ccusage.) The defensible difference: every competitor optimizes exactly one axis (output filtering, or routing, or read-dedup); token-diet diagnoses the architecture and restructures across **all eight** at once.

## Measured impact (originating case)

23-round autonomous research loop (Claude Code, Opus + Sonnet): ~1.1M tokens/round → ~100–180k/round, subagent useful-work ratio ~9% → ~40%, two recorded LLM-judgment errors eliminated by the script kernel. The domain contributed nothing — the architecture did.

## Privacy & feedback

**token-diet runs entirely on your machine and sends nothing by default.** It reads your local Claude Code transcripts and writes to your project — no network calls, no account, no analytics.

The one exception is **strictly opt-in**: **`token-diet savings --share`** builds an **aggregate-only** report (version, OS, a random anonymous install id, your grade, projected + measured reduction % — **no paths, names, commands, or code**) and prints a pre-filled, **public** GitHub issue link you choose to submit (or POSTs it if *you* set `TOKEN_DIET_TELEMETRY_URL`). Preview the exact bytes with `token-diet savings --share --dry-run`. Not sharing costs you nothing.

## Fidelity guarantee

token-diet measures real transcript usage (not chars/4 estimates) and never trims information irrecoverably — every trim is a *move*, not a delete: content goes to an on-demand reference file with a pointer left behind.

## Contributing

Issues and PRs welcome. The repo is **zero-dependency Node** — `npm test` runs the suite (`node --test`, 191 tests) and CI runs it on Node 18/20/22. Coverage is **~85% of lines overall**, and every path that writes a file or rewrites live tool output (the filter, `fix`, atomic writes, scan, install/setup) sits at **87–100%** — the safety-critical surface is where the tests are deepest. Two house rules carry the project's own methodology: keep determinism **in the CLI** (the LLM only judges), and make every trim a **move to a reference**, never a delete. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md); notable changes are tracked in the [changelog](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).

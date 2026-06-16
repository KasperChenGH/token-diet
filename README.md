# token-diet

[![CI](https://github.com/KasperChenGH/token-diet/actions/workflows/ci.yml/badge.svg)](https://github.com/KasperChenGH/token-diet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2018-brightgreen.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

> **Token observability for your AI agents — read your real transcripts, see where the architecture wastes tokens, and restructure it.**

Agentic pipelines burn tokens *structurally* — too many helper agents, the same instruction files reloaded every step, results re-computed, verbose output re-sent every turn — not because of *what* the agents say but *how they're built*. **token-diet** is a Claude Code agent + CLI + skill that measures where your tokens actually go (from real usage logs, not estimates), sorts the waste into **8 levers**, and fixes it — moving content to references, never deleting. On the originating project a 23-round research loop fell from **~1.1M to ~100–180k tokens/round**. (Its automatic output filter is the easy set-and-forget win — a measured **−68%** on shell output — but the bigger money is structural: too many agents, reloaded context, and files re-read 100×.)

It eats its own dogfood — ***scripts compute, LLM judges***: a zero-dependency CLI does every measurement and applies every edit mechanically; the model is used only for the keep-or-trim judgment calls.

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

## Install the agent

The CLI is the engine; the `/token-diet` agent drives it. Deploy the agent + subagents + `/token-diet` command + skill into Claude Code — pick a scope:

```bash
token-diet init --global          # all projects   → ~/.claude/
# or, inside one repo:
cd your-repo && token-diet init   # this repo only  → ./.claude/
```

Reload Claude Code, then run **`/token-diet`** (or just say *"put this project on a token diet"*).

> `npm install -g` installs only the CLI. What makes token-diet global vs. project-scoped is where `init` places the Claude Code artifacts (`--global` or not). The project `.claude/` files are plain text — **commit** them to share the setup with your team, or **gitignore** them to keep it personal.

## How to use it — two modes

**Start with Mode 1** — the structural review is where the real savings are. **Mode 2** (the output filter) is an automatic quick-win you can also leave running, but on its own it's the smaller pool. Most people do the review once, then keep the filter on.

### Mode 1 · Review — `/token-diet`  (full control)

Run the agent. It **measures** your real token usage, **finds** the structural waste (sorted into the 8 levers), and **shows you a plan** with the expected savings — then **stops**. Nothing in your project changes until you approve (reply *approve all*, *approve 1,3*, or *none*), and every applied change is a **move, never a delete**. This is the mode for the big structural wins, where you want to see each trim before it lands.

### Mode 2 · Auto — `token-diet setup`  (set-and-forget)

**The problem it fixes:** noisy command output — a test run, a `git diff`, a build log — gets re-sent to the model on *every* later turn, quietly inflating your bill. Auto mode runs a filter that compresses that output the moment it appears, so the bloat never piles up. Nothing to review — it just works in the background.

It turns on in **three one-time steps**, so it can never surprise you:

```bash
token-diet setup              # 1 · install — starts in WATCH-ONLY mode: shows what it would cut, changes nothing
token-diet filter --report    # 2 · check — the savings it would make on your own real output
token-diet filter --activate  # 3 · go live — now it actually compresses
```

After step 3 it's genuinely set-and-forget. Even when live, the full original output is always saved to a sidecar file with a pointer back to it — nothing is ever lost — and you can `token-diet filter --disable` anytime. (Step 1's "watch-only" state is the filter's **audit** mode.)

<details>
<summary>Bonus: <code>setup</code> also adds a commit-time guard</summary>

`setup` drops in a git pre-commit hook (`token-diet review --dir .`) that re-grades your `.claude/` design and warns if it regresses. To make a regression **block** the commit instead of just warning, edit `.git/hooks/pre-commit` and append `--fail-under C` to that review line. Purely optional — the filter above works without it.
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
token-diet init [--global]                         # install the agent + subagents + command + skill

# VERIFY — did it work?
token-diet compare --before-days 14 --after-days 7 # per-day deltas across windows; the re-measure bookend
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

Bookends: measure first (this CLI), re-measure + adversarial consistency review after. Full methodology with red flags and common mistakes: **[SKILL.md](skills/SKILL.md)**.

## Measured reduction

Pooled across **eight production codebases**, counting only what the default filter actually compresses — **shell output (Bash + PowerShell)**, weighted by token volume (not a min–max over a few runs). The **calls** column is the sample size, shown rather than hidden. These are **per-call** savings, but each compressed result is what gets re-sent on every later turn, so the cut **compounds through `cache_read`** — your dominant cost (~99.6% of token volume). For the whole-session effect, use `token-diet compare`.

| tool output | what it keeps · what it collapses | calls | reduction |
|---|---|---|---|
| **git** — `status` / `diff` / `log` | branch + changed files + diff hunks · unchanged-tree noise | 49 | **−81%** |
| **tests** — pytest / jest / cargo / go / Pester | failures, tracebacks, the pass/fail summary · passing runs | 31 | **−85%** |
| **logs / other** shell output | dedups repeats · head/tail-elides middles (errors/warnings always kept) | 298 | **−62%** |
| **shell total** — Bash + PowerShell (the safe default) | the rows above, blended | **378** | **−68%** |
| **builds** — npm / cargo / docker / tsc / eslint | errors, warnings, the final summary · per-package/layer progress | — | **−86…−98%** \* |
| **file reads** — Lever 5, via `token-diet digest` | one authored digest replaces N repeated full reads (demonstrated) | — | **~−42%** † |

The **shell total** is the headline: **−68% across 378 calls** (584k → 185k tokens). Structured output compresses hardest — tests **−85%**, git **−81%**, meeting or beating a specialized Rust command-rewriter's ~−80% headline; the blend is held down by free-form logs, which dominate the volume and have no schema to exploit. The lower-call rows (tests, git) are lightly sampled — these codebases run few large suites through the shell. (Only shell tools are counted: Read/Grep/Task results are excluded because the default filter never touches them — see Lever 5.) These are **per-call** figures; on a heavy real session the per-call saving is a rounding error, but **compounded through `cache_read`** (a compressed output is re-sent every later turn) it is the dominant effect — measure the whole-session result with `token-diet compare`.

\* **builds** — **−98%** on a real verbose `npm install` (823 → 15 lines); the eight pooled codebases show none because modern build tools are quiet by default, so verbose build output (cargo, webpack, docker, `npm --verbose`) is where the **−86…−98%** lands.
† **file reads** — *not* in the shell total and *not* an automatic filter win: a separate, opt-in mechanism. It's by far the bigger pool — **5.4M read tokens**, of which **93% are re-reads** (the same files pulled 100–300×) that digests address, vs only 584k on shells. **Demonstrated end-to-end:** a real 775-line source file (7,361 tok) was compressed to a **625-token digest** that carries its purpose, API, and gotchas — **−92% per reference read**. The ~42% headline is the conservative blend, since some reads (e.g. editing) still need the full source. Surface candidates with `token-diet digest`, then `--scaffold` a skeleton for an agent to summarize.

`cache_read` itself is never a row — it's not a kind of output, it's the re-transmission of everything above; the filter and digest shrink the *sources* that feed it.

## The output filter — safe by default

The Lever 8 filter compresses verbose tool output before it re-enters context. It's built so you can **prove it's safe on your output before it changes anything** — enabling never jumps straight to live compression:

```bash
token-diet filter --install     # wire the PostToolUse hook (off)
token-diet filter --enable      # AUDIT: records what it *would* save — output UNCHANGED
token-diet filter --report      # the measured reduction table from your real sessions
token-diet filter --activate    # go live (the one switch you flip yourself)
token-diet filter --disable     # turn it back off anytime
```

In **audit** mode the filter runs on every matched call, records the would-be saving to `.claude/toolout/stats.jsonl`, but returns the original output unchanged. You review `--report`, confirm the reductions look right, then `--activate`. Even when live, the full output is always kept in `.claude/toolout/<ts>.log` with a pointer, so nothing is lost. It compresses **shell output (Bash + PowerShell) by default** (Read/Grep are opt-in, since those are better handled by Lever 5 digests; Task/Edit results are left untouched).

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
├── bin/token-diet.js              CLI entry — subcommands: review · estimate · audit · agents ·
│                                  diagnose · overhead · plan · fix · filter · digest · compare · init · setup
├── src/filter.js                  Lever 8 output-compression engine (PostToolUse hook)
├── src/digest.js                  Lever 5 read-digest prototype: finds re-read files, scaffolds skeletons
├── src/*.js                       the deterministic engine (zero deps, no LLM): scan, collectors,
│                                  review, estimate, diagnose, plan, changeset, fix, compare, history, …
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

## Measured impact (originating case)

23-round autonomous research loop (Claude Code, Opus + Sonnet): ~1.1M tokens/round → ~100–180k/round, subagent useful-work ratio ~9% → ~40%, two recorded LLM-judgment errors eliminated by the script kernel. The domain contributed nothing — the architecture did.

## Fidelity guarantee

token-diet works at the architecture layer — it measures real transcript usage (not chars/4 estimates) and never trims information irrecoverably. Every trim is a *move*, not a delete: content goes to an on-demand reference file with a pointer left behind. Think of it as a personal trainer for your agents — it weighs them, finds the flab, and cuts it without touching the muscle (information).

## Contributing

Issues and PRs welcome. The repo is **zero-dependency Node** — `npm test` runs the suite (`node --test`) and CI runs it on Node 18/20/22. Two house rules carry the project's own methodology: keep determinism **in the CLI** (the LLM only judges), and make every trim a **move to a reference**, never a delete. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md); notable changes are tracked in the [changelog](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).

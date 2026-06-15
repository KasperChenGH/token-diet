# token-diet

> Optimize the architecture before the artifacts.

**An agent that puts your agents on a diet.** Install it, type `/token-diet`, and it measures your real token spend, diagnoses the structural waste, presents a reduction plan, executes the approved items, and verifies the result. Three layers:

- **An agent** (`/token-diet`) that drives the whole workflow on your project — with a hard approval gate before it touches any file
- **A CLI** that owns every deterministic step — real transcript measurement, overhead quantification, rule-based waste *detection*, the plan/changeset *skeleton*, mechanical edit *application*, and before/after re-measurement. The LLM is never asked to count, compute, or apply. (The one forward projection, `estimate`, is labelled a model — not a measurement.)
- **A skill** carrying the architecture-first methodology (measured ~85% per-round reduction on the originating project)

The product eats its own dogfood: *scripts compute, LLM judges* — the agent never estimates what the CLI can measure, and never recomputes what the plan already concluded.

## In plain English

Your AI coding agents waste tokens — which costs money and burns through usage limits — not because of *what* they say, but because of *how they're set up*: too many helper agents, the same big instruction files reloaded on every step, the model re-doing arithmetic it shouldn't, verbose command output piped back into the conversation forever.

token-diet is an agent that audits that setup and fixes it. You type `/token-diet` and it:

1. **Measures** where your tokens actually go (reads your real Claude Code usage logs — no guessing).
2. **Finds** the structural waste, sorted into 8 well-known causes ("levers").
3. **Shows you a plan** with the expected savings — and stops, waiting for your approval.
4. **Applies** the changes you approve — always *moving* content to a reference file, never deleting it.
5. **Re-measures** to prove it actually worked.

A plain, dependency-free CLI does all the measuring and *applies* every approved edit mechanically; the AI is used only for the judgment calls — deciding *which* changes to make and writing any new content. (The CLI flags suspects by fixed rules; the AI gives the final keep-or-trim verdict.) Think of it as a personal trainer for your AI agents: it weighs them, finds the flab, and puts them on a diet — without cutting any muscle (information).

## Install

First get the CLI tool (or use it via `npx`):

```bash
npm install -g github:KasperChenGH/token-diet
```

Then deploy the agent + 10 subagents + `/token-diet` command + skill into Claude Code — pick a scope:

**A) All your projects (global)** — installs into `~/.claude/`:

```bash
token-diet init --global
```

**B) One repo only (project-scoped)** — installs into that repo's `./.claude/`:

```bash
cd your-repo
token-diet init            # no --global → project-local
```

Reload Claude Code, then run **`/token-diet`** (or tell Claude *"put this project on a token diet"*).

The optional **output filter** (Lever 8 engine) scopes the same way — `token-diet filter --install [--global]`. It's **safe by default**: `--enable` starts in **audit mode** (records what it *would* save without changing any output — review with **`token-diet filter --report`**, a *measured* reduction table from your real sessions), and only `--activate` makes it live. It compresses **Bash output by default** (Read/Grep are opt-in via `tools` in `filter.json`, since those are better handled by Lever 5 digests), always keeps the full output in a sidecar, and you can shield specific lines from compression with `keep` regexes in `filter.json`.

**One-command ongoing protection:** `token-diet setup` wires it all at once — the filter (audit mode) **and** a git pre-commit *drift reminder* (`token-diet review`, add `--fail-under C` to block on regression). The `/token-diet` agent also offers this at the end of its run, so a single run leaves you protected; the only thing left is `filter --activate` once you've eyeballed `filter --report`. And the project `.claude/` artifacts are plain files: **commit** them to share the setup with your team, or **gitignore** them to keep it personal.

> The `npm install -g` step installs only the *CLI tool* globally. What makes token-diet global vs. project-scoped is where `init` places the Claude Code artifacts — controlled by the presence of `--global`.

## Start here: static project review (no usage history needed)

```bash
token-diet review --dir .
```

Reviews your project's `.claude/` design — CLAUDE.md, commands, agents, skills — and grades it (A–F) against all 8 levers, telling you how to cut token usage **before you've spent a token**. Works on a brand-new project. Global infrastructure is reported separately so your project is graded on what it owns.

Sample (a heavy real project):
```
Lever 1  Delete ceremonial agents   5 findings  med   (3 commands fan out >= 3 subagents)
Lever 2  Merge sessions             2 findings  med   (process.md: prepare + finalize per cycle)
Lever 3  Evict in-session compute   7 findings  med   (sweep/backtest run inside sessions)
Lever 4  Scripts for determinism    2 findings  high  (LLM computes verdict/margin)
Lever 6  Always-loaded overhead     3 findings  med   (report.md 153 lines; 3,800 tok/spawn → 38k at N=10)
Lever 7  Model arbitrage            1 finding   high  (12 command files, no model pin)
Grade: F
```

## The workflow (when you have usage history too)

```bash
# MEASURE — where do tokens actually go?
token-diet audit   [--days 7] [--project myapp]   # usage by session-kind × model + heaviest sessions
token-diet agents                                  # useful-work ratio per agent; flags READING NOT THINKING

# DIAGNOSE — what structural waste exists?
token-diet diagnose                                # red flags mapped to levers (hot files, low-ratio agents,
                                                   # turny sessions, idle babysitting, model mix)
token-diet overhead [--dir .]                      # always-loaded burden (now folded into `review`): CLAUDE.md, commands, skills —
                                                   # what EVERY spawn pays, at N=1/5/10 agents

# ACT — turn findings into work
token-diet plan --out diet-plan.md                 # ordered checkbox plan per lever with evidence + est. savings;
                                                   # hand it to your agent: "execute diet-plan.md"
token-diet init [--global]                         # install the agent + subagents + command + skill + rubrics

# VERIFY — did it work?
token-diet compare --before-days 14 --after-days 7 # per-day deltas across windows; the re-measure bookend
```

Sample (real project, 3 days):

```
HOT FILES (Lever 5): file_a.py read 125x, file_b.py 80x, HANDOVER.md 41x ...
LOW-RATIO AGENTS: 14/36 sessions below 0.15 — worst spends 93% of budget on context, 7% on thinking
IDLE BABYSITTING: session 00000000 idle 3,083 min across 329 calls (compute running inside the session)
MODEL MIX: 100% top-tier output while subagents exist -> arbitrage available
```

Usage is deduplicated per API request (`requestId`) — Claude Code writes 2–3 transcript lines per call with repeated usage; naive summing inflates totals ~2–3×. This tool counts each call once.

The review phase uses per-lever specialist sub-agents: for each lever with ≥ 2 findings, a parallel Sonnet specialist judges only its flagged files, returning per-item KEEP / MOVE / DISPOSE-CANDIDATE verdicts. Each specialist is deployed **self-contained** — its lever rubric, its private professional knowledge (e.g. summarization technique for the digester, data-cleaning criteria for the trimmer), and a shared fidelity/audit contract are all inlined into the agent at install time, so it needs no runtime file lookups. Clean levers (0–1 findings) are judged inline — no subagent spawned.

## The methodology (the skill)

Eight levers, in leverage order — each shrinks the next:

1. **Delete agents** — every spawn must buy parallelism, isolation, or model-arbitrage worth more than its ~20–40k establishment tax
2. **Merge sessions** — one per cycle; state in files, never conversations
3. **Evict compute** — long commands run in drivers between sessions: zero tokens
4. **Scripts compute, LLM judges** — deterministic kernels emit conclusions
5. **Tier the knowledge** — living doc → digests → archive
6. **Trim the always-loaded** — every spawn pays for it
7. **Model arbitrage** — big model only where judgment lives
8. **Filter tool output** — verbose test/build/log stdout compressed at the source, never re-sent every turn

Bookends: measure first (this CLI), re-measure + adversarial consistency review after.

Full methodology with red flags and common mistakes: [SKILL.md](skills/SKILL.md).

## What's in the box (project layout)

```
token-diet/
├── bin/token-diet.js              CLI entry — subcommands: review · estimate · audit · agents ·
│                                  diagnose · overhead · plan · fix · filter · compare · init
├── src/filter.js                  Lever 8 output-compression engine (PostToolUse hook):
│                                  compresses verbose tool output → context, full output → sidecar
├── src/*.js                       the deterministic engine (zero deps, no LLM): scan,
│                                  collectors, review, estimate, diagnose, plan,
│                                  changeset, fix, compare, history, …
├── skills/
│   ├── SKILL.md                   the 8-lever methodology (the main skill)
│   └── shared/                    knowledge shared across subagents (inlined on install)
│       ├── specialist-contract.md     how every specialist returns verdicts
│       ├── cost-mechanics.md          the token cost model
│       ├── information-preservation.md never-lose-info fidelity rule
│       └── audit-method.md            evidence + confidence scoring
├── agents/
│   ├── token-diet.md              tier-1 orchestrator (the /token-diet agent)
│   ├── subagent-analyst.md        tier-2 — measures, plans, spawns specialists, merges
│   └── subagent-<role>.md  ×9     tier-3 lever specialists (9 across the 8 levers; Lever 6 has an opt-in prose variant)
├── references/
│   ├── levers/lever-N-*.md  ×8    per-lever judgment rubrics (a specialist's core body)
│   └── subagents/*.md       ×10   per-subagent extra professional knowledge
└── commands/token-diet.md         the /token-diet slash command
```

**How a specialist is assembled:** `init` deploys each subagent **self-contained** by inlining
`agent contract + its lever rubric + its private knowledge + shared contracts` into one file —
because spawned subagents run in your project dir and can't read companion files at runtime.

## Measured impact (originating case)

23-round autonomous research loop (Claude Code, Opus + Sonnet): ~1.1M tokens/round → ~100–180k/round, subagent useful-work ratio ~9% → ~40%, two recorded LLM-judgment errors eliminated by the script kernel. The domain contributed nothing — the architecture did.

## Fidelity guarantee

token-diet works at the architecture layer — it measures real transcript usage (not chars/4 estimates) and never trims information irrecoverably. Every trim is a *move*, not a delete: content goes to an on-demand reference file with a pointer left behind, so nothing is lost.

## License

MIT

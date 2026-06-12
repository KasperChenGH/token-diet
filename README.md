# token-diet

> Optimize the architecture before the artifacts.

**An agent that puts your agents on a diet.** Install it, type `/token-diet`, and it measures your real token spend, diagnoses the structural waste, presents a reduction plan, executes the approved items, and verifies the result. Three layers:

- **An agent** (`/token-diet`) that drives the whole workflow on your project — with a hard approval gate before it touches any file
- **A CLI** that does everything deterministic: transcript measurement, overhead quantification, plan generation, before/after verification — no LLM, no estimates, no vibes
- **A skill** carrying the architecture-first methodology (measured ~85% per-round reduction on the originating project)

The product eats its own dogfood: *scripts compute, LLM judges* — the agent never estimates what the CLI can measure, and never recomputes what the plan already concluded.

## Install

```bash
npm install -g github:KasperChenGH/token-diet
token-diet init --global     # deploys agent + command + skill into ~/.claude/
```

Then in any project: **`/token-diet`** — or just tell Claude "put this project on a token diet."

## The workflow

```bash
# MEASURE — where do tokens actually go?
token-diet audit   [--days 7] [--project myapp]   # usage by session-kind × model + heaviest sessions
token-diet agents                                  # useful-work ratio per agent; flags READING NOT THINKING

# DIAGNOSE — what structural waste exists?
token-diet diagnose                                # red flags mapped to levers (hot files, low-ratio agents,
                                                   # turny sessions, idle babysitting, model mix)
token-diet overhead [--dir .]                      # static always-loaded burden: CLAUDE.md, commands, skills —
                                                   # what EVERY spawn pays, at N=1/5/10 agents

# ACT — turn findings into work
token-diet plan --out diet-plan.md                 # ordered checkbox plan per lever with evidence + est. savings;
                                                   # hand it to your agent: "execute diet-plan.md"
token-diet init [--global]                         # install the methodology skill the agent uses to execute it

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

## The methodology (the skill)

Seven levers, in leverage order — each shrinks the next:

1. **Delete agents** — every spawn must buy parallelism, isolation, or model-arbitrage worth more than its ~20–40k establishment tax
2. **Merge sessions** — one per cycle; state in files, never conversations
3. **Evict compute** — long commands run in drivers between sessions: zero tokens
4. **Scripts compute, LLM judges** — deterministic kernels emit conclusions
5. **Tier the knowledge** — living doc → digests → archive
6. **Trim the always-loaded** — every spawn pays for it
7. **Model arbitrage** — big model only where judgment lives

Bookends: measure first (this CLI), re-measure + adversarial consistency review after.

Full methodology with red flags and common mistakes: [SKILL.md](SKILL.md).

## Measured impact (originating case)

23-round autonomous research loop (Claude Code, Opus + Sonnet): ~1.1M tokens/round → ~100–180k/round, subagent useful-work ratio ~9% → ~40%, two recorded LLM-judgment errors eliminated by the script kernel. The domain contributed nothing — the architecture did.

## License

MIT

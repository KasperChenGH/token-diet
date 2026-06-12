# token-diet

> Optimize the architecture before the artifacts.

Measure, diagnose, and cut token waste in agentic / multi-agent workflows. Two parts:

- **A CLI** that audits real Claude Code transcript usage and flags structural waste deterministically — no LLM, no estimates, no vibes
- **A skill** that teaches the agent the architecture-first restructuring methodology (measured ~85% per-round reduction on the originating project)

The tool eats its own dogfood: *scripts compute, LLM judges* — measurement and red-flag detection are code; only the restructuring judgment goes to the model.

## Install

```bash
# CLI (no registry needed):
npm install -g github:KasperChenGH/token-diet

# Companion skill for Claude Code:
git clone https://github.com/KasperChenGH/token-diet ~/.claude/skills/token-diet
```

## CLI usage

```bash
token-diet audit                  # usage by session-kind × model: fresh-in / cache-write / cache-read / output
token-diet audit --days 7 --project myapp --json

token-diet agents                 # per-session/agent useful-work ratio; flags "READING NOT THINKING" (< 0.15)

token-diet diagnose               # red-flag findings mapped to the skill's levers:
                                  #   HOT FILES        -> Lever 5 (knowledge tiers)
                                  #   LOW-RATIO AGENTS -> Lever 1/7 (agent census / arbitrage)
                                  #   TURNY SESSIONS   -> batching (reads = context x turns)
                                  #   IDLE BABYSITTING -> Lever 3 (evict compute)
                                  #   MODEL MIX        -> Lever 7 (arbitrage)
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

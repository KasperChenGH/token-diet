# token-diet

> Optimize the architecture before the artifacts.

A [Claude Code skill](https://agentskills.io) that teaches agents to cut token usage in agentic / multi-agent workflows by **~85%** — by removing the agents, sessions, turns, and LLM-work that shouldn't exist, before touching prompts or models.

## Before / After (measured, real autonomous research loop)

| Per round | Before | After |
|---|---|---|
| Total tokens | ~1.1M | ~100–180k |
| Subagent useful-work ratio | ~9% | ~40% |
| Sessions per round | 2 + 7–10 subagents | 1 + 0–3 conditional subagents |
| LLM-computed verdict errors | 2 recorded | 0 (moved to script kernel) |

Two-day research window: `2.3M output + 12.4M cache-writes + 206M cache-reads` → est. `0.7M + 3M + 55M` for the same research volume.

## The seven levers (in order of leverage)

1. **Delete agents** — every subagent must buy parallelism, isolation, or model-arbitrage worth more than its ~20–40k establishment tax. Spawning becomes *conditional*.
2. **Merge sessions** — one session per cycle that ends by staging the next; state lives in files, never conversations.
3. **Evict compute** — long commands run in a driver script between sessions: zero tokens, no babysitting.
4. **Scripts compute, LLM judges** — deterministic kernels emit conclusions; the LLM judges surprises only.
5. **Tier the knowledge** — living doc (<100 lines, always loaded) → digests (~2k) → archive (on demand).
6. **Trim the always-loaded** — CLAUDE.md and entry-point commands pay their tax on *every* spawn; self-contained contracts per entry point.
7. **Model arbitrage** — big model where judgment lives, small model for everything mechanical.

Plus the two bookends: **measure first** (sum real usage from transcripts; know cache-read vs cache-write mechanics) and **re-measure + adversarial consistency review** after (every architecture change leaves stale contracts in files it didn't touch).

## Install

**Claude Code (personal skill):**

```bash
git clone https://github.com/<you>/token-diet ~/.claude/skills/token-diet
```

Or per-project: clone into `<project>/.claude/skills/token-diet`.

That's it — Claude discovers it by description. Trigger it by hitting the symptoms ("we keep hitting usage limits", "why are cache reads so high", "audit our agent token usage") or explicitly: *"use the token-diet skill"*.

## What's in the skill

- A measurement method (transcript usage audit, useful-work ratio per agent)
- The seven levers as a quick-reference table with the question each one asks
- Red flags and a common-mistakes table (including the ones competent agents make: optimizing file sizes while keeping ceremonial agents, treating cache reads as a file-size problem)

## Provenance

Distilled from a real 23-round autonomous trading-research loop on Claude Code (Opus + Sonnet), where each optimization was measured against transcript usage data. Built test-first: the skill's content targets the exact gaps a competent agent exhibited on the same scenario without it.

## License

MIT

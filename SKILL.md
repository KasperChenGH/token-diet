---
name: token-diet
description: Use when an agentic or multi-agent workflow burns excessive tokens — usage limits hit repeatedly, high cache read/write volume, subagents spending most of their budget re-reading static files, every round/session re-establishing the same context, or an LLM recomputing deterministic results. Also use before designing any recurring multi-agent loop.
---

# Token Diet

## Overview
Most token waste in agentic systems is **structural**, not stylistic. Shorter prompts and smaller models are the last 20%; the first 80% comes from removing agents, sessions, turns, and LLM-work that shouldn't exist. Work the levers in order — each level makes the next one smaller.

**Core principle: optimize the architecture before the artifacts.**

## Step 0 — Measure before touching anything
Don't trust intuition; sum real usage from transcripts (in Claude Code: `~/.claude/projects/<project>/*.jsonl`, each assistant message carries `usage`). Split by: output, cache writes, cache reads, per agent/session. Compute each agent's **useful-work ratio** = reasoning+output tokens ÷ total. An "expert" at 9% is reading, not thinking.

Know the mechanics you're optimizing:
- **Cache reads** = context size × turn count. Re-sent every turn at ~0.1× price. Cut turns (batch independent tool calls into one message) AND context size.
- **Cache writes** = new context first cached, ~1.25× price — ~12× dearer per token than reads. Scales with *agent/session count* — every spawn re-caches its files.
- **Output** = full price. Scales with narrative habits and recomputed analysis.

## The levers, in order of leverage

| # | Lever | Question to ask | Typical saving |
|---|---|---|---|
| 1 | **Delete agents** | Does each subagent buy parallelism, isolation, or model-arbitrage worth more than its ~20–40k establishment tax? If not: don't spawn — do it inline or not at all. Make spawning *conditional* (e.g. "only if 2+ distinct mechanisms AND >30 result rows"). | 40–60% |
| 2 | **Merge sessions** | Can N sessions per cycle become 1 that ends by *staging the next cycle*? Carry state in files, never in conversation — fresh sessions are also your no-contamination guarantee. | 25–40% of the rest |
| 3 | **Evict compute** | Is any long-running command (builds, sweeps, training) inside a session? Move it to a driver script (shell/cron) between sessions: zero tokens, no timeout, no session-death babysitting. | all compute-adjacent tokens |
| 4 | **Scripts compute, LLM judges** | Is the LLM doing arithmetic, threshold checks, verdict math, format conversion? Write a deterministic kernel that emits conclusions; the LLM reads conclusions and judges only surprises/next-steps. Bonus: removes LLM math drift. | 30–50% of analysis tokens + correctness |
| 5 | **Tier the knowledge** | Are agents re-reading static reference packs every run? Three tiers: a <100-line *living doc* (always loaded; rules, current state, open questions — replace-don't-append), *digests* (~2k distillations of each domain pack, with `Source:` pointers), *archive* (full files, on-demand only). | 50–80k per agent per run |
| 6 | **Trim the always-loaded** | What loads into EVERY agent (CLAUDE.md, command files, tool surface)? Cut to essentials; move depth to on-demand reference files. Each entry-point command must be **self-contained** — prose mode-overrides on shared step lists WILL be misread by autonomous agents. | 2–5k × every spawn |
| 7 | **Model arbitrage** | Big model only where judgment lives; small model for mechanical work (focused reviews, data crunching, bulk edits). Delegate the main agent's mechanical multi-turn work to one small-model agent instead of many big-context turns. | 3–5× on delegated share |

## Step N — Re-measure and review
Compare actuals to your estimates after one cycle. Then run an **adversarial consistency review**: every architectural change leaves stale contract copies in files it didn't touch; have an independent agent hunt contradictions across all entry points.

## Red flags — you're doing it wrong if…
- You started with prompt wording or model choice (start with the agent census)
- A subagent exists "for thoroughness" with no parallelism/isolation/arbitrage justification
- Sessions wait on multi-minute commands
- The LLM computes anything a 100-line script could
- Knowledge packs are re-read verbatim every cycle ("it might need the detail")
- State carries over via conversation/summaries instead of files
- You "saved tokens" but never measured before AND after

## Common mistakes
| Mistake | Fix |
|---|---|
| Optimizing file sizes while keeping 7 ceremonial agents | Lever 1 first — the census, not the diet |
| Treating cache reads as a file-size problem | They're (context × turns); batching turns cuts them as much as smaller files |
| Digesting knowledge but agents still load full packs "to be safe" | Digest carries `Source:` pointers; contract says full file ONLY when a specific claim needs depth |
| Merging sessions by letting one grow forever | One session per *cycle*, fresh each time; files are the memory |
| Assuming spawned-agent overhead is waste to eliminate entirely | It's the price of isolation — pay it only where isolation/parallelism/arbitrage is worth it |

## Real-world impact
Measured on a 23-round autonomous trading-research loop (Claude Code, Opus + Sonnet): ~1.1M tokens/round → ~100–180k/round (≈85% cut) while *increasing* reliability — useful-work ratio of subagents went from ~9% to ~40%, and moving verdict math to a script kernel eliminated two recorded LLM-judgment errors. Per 2-day window: 2.3M output + 12.4M cache-writes + 206M cache-reads → est. 0.7M + 3M + 55M for the same research volume.

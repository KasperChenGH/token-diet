---
name: token-diet
description: Use when an agentic or multi-agent workflow burns excessive tokens — usage limits hit repeatedly, high cache read/write volume, subagents spending most of their budget re-reading files, every session re-establishing the same context, or an LLM recomputing deterministic results. Also use before designing any recurring multi-agent pipeline (CI agents, review bots, research loops, support triage, data workflows).
---

# Token Diet

## Overview
Most token waste in agentic systems is **structural**, not stylistic. Shorter prompts and cheaper models are the last 20%; the first 80% comes from removing agents, sessions, turns, and LLM-work that shouldn't exist. Work the levers in order — each level shrinks the next.

**Core principle: optimize the architecture before the artifacts.**

Applies to any recurring agent workflow: PR-review fleets, CI fix-bots, research/analysis loops, support triage, content pipelines, data-quality agents.

## Step 0 — Measure before touching anything
Don't trust intuition. Sum real usage from wherever your stack records it (API responses carry `usage` per call; Claude Code stores per-message usage in `~/.claude/projects/<project>/*.jsonl`; most frameworks log equivalents). Split by: output, cache writes, cache reads, per agent and per session. Compute each agent's **useful-work ratio** = reasoning+output ÷ total tokens. An agent at 10% is reading, not thinking.

Mechanics you're optimizing:
- **Cache reads** = context size × turn count, re-sent every turn (~0.1× price). Two cuts: fewer turns (batch independent tool calls into one message) and smaller context.
- **Cache writes** = new context first cached (~1.25× price, ≈12× dearer per token than reads). Scales with *spawn count* — every new agent/session re-caches its files.
- **Output** = full price. Scales with narrative habits and LLM-recomputed analysis.

## The levers, in order of leverage

| # | Lever | The question | Typical saving |
|---|---|---|---|
| 1 | **Delete agents** | Does each subagent buy parallelism, isolation, or model-arbitrage worth more than its establishment tax (system prompt + tools + shared files ≈ 20–40k per spawn)? If not, do the work inline — or not at all. Make spawning *conditional* on measurable triggers (reviewers only when code changed; analysts only when results exceed what one pass can hold; never "for thoroughness"). | 40–60% |
| 2 | **Merge sessions** | Can N sessions per cycle (plan→execute→summarize; triage→fix→report) become ONE that ends by writing state and staging the next cycle? Carry state in files/tickets/DB — never in conversation. Fresh sessions per cycle are also your contamination guarantee. | 25–40% of the rest |
| 3 | **Evict compute** | Is any long-running command (builds, test suites, training, batch jobs) running inside a session, with the agent babysitting it? Move it to a driver (shell script, CI step, cron) between sessions: zero tokens, no timeouts, no died-while-waiting failures. | all compute-adjacent tokens |
| 4 | **Scripts compute, LLM judges** | Is the LLM doing arithmetic, diffing, threshold checks, pass/fail verdicts, format conversion, report assembly? Write a deterministic kernel that emits conclusions; the LLM reads conclusions and judges only the surprises and the next decision. Bonus: eliminates LLM math/judgment drift. | 30–50% of analysis tokens + correctness |
| 5 | **Tier the knowledge** | Are agents re-reading static reference material every run (style guides, domain docs, API references, runbooks)? Three tiers: a **living doc** (<100 lines, always loaded: rules, current state, open items — replace, don't append), **digests** (~2k distillations per pack, each section carrying a `Source:` pointer), **archive** (full files, pulled only when a specific claim needs depth). | 50–80k per agent per run |
| 6 | **Trim the always-loaded** | What loads into EVERY agent (project instructions file, entry-point commands, tool surface)? Cut to essentials; depth goes to on-demand reference files. Each autonomous entry point gets a **self-contained contract** — prose mode-overrides layered on shared instructions WILL eventually be misread by an autonomous agent. | 2–5k × every spawn |
| 7 | **Model arbitrage** | Reserve the big model for where judgment lives (strategy, synthesis, ambiguous calls). Route mechanical work — focused reviews, extraction, bulk edits, data crunching — to a small model. Also: delegate a big-context agent's mechanical multi-turn work to ONE small-model agent instead of burning big-context turns. | 3–5× on the delegated share |
| 8 | **Filter tool output** | Are verbose command outputs (test suites, build logs, git status, large file reads) dumped whole into context, then re-sent every turn as cache reads? Filter at the source: a PostToolUse hook that compresses stdout (failures-only for tests, single-line confirms for git, signatures-only for big file reads, dedup repeated log lines). | often the largest cache-read source |

Ready-made: the `rtk` CLI (github.com/rtk-ai/rtk) installs exactly this as a Bash PostToolUse hook. token-diet measures whether you need it; rtk is one way to apply it.

## Step N — Re-measure and review
After one cycle on the new architecture, compare actuals to estimates. Then run an **adversarial consistency review** with an independent agent: every architectural change leaves stale instruction copies in files it didn't touch — hunt contradictions across all entry points before trusting the system unattended.

## Red flags — wrong order of operations
- You started with prompt wording or model choice (start with the agent census)
- A subagent exists "for thoroughness", with no parallelism/isolation/arbitrage justification
- Sessions wait on multi-minute commands
- The LLM computes anything a 100-line script could
- Reference packs are re-read verbatim every cycle ("it might need the detail")
- State carries across cycles via conversation history or summaries instead of files
- You "saved tokens" without measuring before AND after
- Test/build/log output dumped whole into context instead of filtered to the relevant lines

## Common mistakes
| Mistake | Fix |
|---|---|
| Optimizing file sizes while keeping ceremonial agents | Lever 1 first — census, then diet |
| Treating cache reads as a file-size problem | Reads = context × turns; batching tool calls cuts them as much as smaller files |
| Digests written, but agents still load full packs "to be safe" | The contract: digest by default, full file ONLY when a named claim needs depth — and digests carry `Source:` pointers to make that cheap |
| Merging sessions by letting one conversation grow forever | One fresh session per cycle; files are the memory, not the transcript |
| Treating spawn overhead as pure waste | It's the price of isolation — pay it exactly where isolation, parallelism, or arbitrage is worth it |
| Skipping the consistency review after restructuring | Stale contracts in untouched files are how autonomous agents go off-script |

## Real-world impact (one measured case)
A 23-round autonomous research loop (Claude Code, Opus + Sonnet): ~1.1M tokens/round → ~100–180k/round (≈85%) while reliability *improved* — subagent useful-work ratio rose from ~9% to ~40%, and moving verdict math into a script kernel eliminated two recorded LLM-judgment errors. The same levers transfer to any recurring agent pipeline; the loop's domain (trading research) contributed nothing to the savings — the architecture did.

# Lever 1 — Ceremonial Agents

**Lever statement:** Every agent spawn must buy parallelism, isolation, or model-arbitrage worth more than its 20–40k token establishment tax. Spawns that exist "for thoroughness" are waste.

---

## Inspect

Read the full body and frontmatter of every flagged `.md` file under:
- `.claude/commands/` (project)
- `.claude/agents/` (project)
- `~/.claude/commands/` (global)
- `~/.claude/agents/` (global)

Note the `tools:` frontmatter list and any `model:` pin. Read the body for: does it fan out sub-calls? Does it enforce a contamination boundary? Does it route to a cheaper model?

---

## Decision tests

**Buys PARALLELISM** — the agent fans out 2+ genuinely independent subtasks that cannot be inlined without becoming sequential. Look for `Agent(` calls or explicit parallel-spawn language inside the body.

**Buys ISOLATION** — the agent needs a fresh, uncontaminated context: adversarial review, second-opinion pass, or a safety gate that must not see the prior session's bias.

**Buys MODEL-ARBITRAGE** — frontmatter pins a cheaper model (`model: haiku` / `model: sonnet`) for mechanical work that the parent session would otherwise run on the top-tier.

**Spawned unconditionally** — the body contains no conditional logic, no trigger guard, no "only if N findings" check. It runs every cycle regardless of need.

| Test result | Verdict |
|---|---|
| Provides ≥1 of the three justifications | KEEP |
| Provides zero justifications AND spawned unconditionally | DISPOSE-CANDIDATE |
| Provides zero justifications BUT spawned conditionally | DISPOSE-CANDIDATE (lower urgency) |

MOVE is not applicable for agents — an agent file either runs or it doesn't; there is no "on-demand" loading equivalent.

---

## DO NOT dispose if

- It is the sole enforcer of a safety gate or approval step (removing it collapses a mandatory human-in-the-loop checkpoint).
- The parallelism is implicit: the file is a template spawned N times by a driver — look for loop/fan-out call sites before deciding.
- The model pin on the agent is the only place that model-arbitrage constraint is expressed for that workflow.
- Removing it would merge two sessions that should stay separate (contamination boundary — defer to Lever 2 reviewer).

---

## Return format

One line per flagged item:

```
<filename> → KEEP|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <what to do if DISPOSE-CANDIDATE>]
```

Example:
```
.claude/commands/report.md → DISPOSE-CANDIDATE: fans out 3 agents but no model pin and unconditional spawn; inline the analysis or add conditional guard + restructure: add `if findings > 0` guard; pin subagents to sonnet
.claude/agents/review-bot.md → KEEP: isolation — adversarial second-opinion pass, must not share context with execution session
```

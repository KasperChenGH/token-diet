# Lever 7 — Model Arbitrage

**Lever statement:** Reserve the top-tier model for genuine judgment and synthesis. Route mechanical work — focused reviews, extraction, bulk edits, data crunching, format conversion — to a smaller model (Sonnet, Haiku). A 3–5× price reduction on the delegated share.

---

## Inspect

Read the frontmatter of every flagged command/agent `.md` file. Check for a `model:` key. If absent, the file defaults to whatever the parent session runs (typically top-tier). Then read the body to classify the work the agent actually does.

Also check the `token-diet agents` model-mix output: what fraction of output tokens are top-tier vs. smaller models? If 100% top-tier and the project has subagents, arbitrage is available.

For each flagged file without a model pin, read enough of the body to answer: is the primary work judgment/synthesis, or is it mechanical?

---

## Decision tests

**Judgment / synthesis work** — the agent must weigh evidence, resolve ambiguity, make strategy calls, synthesize across multiple sources, or produce creative/architectural output. Quality degrades meaningfully on smaller models.

**Mechanical work** — focused review against a rubric (this file), extraction from structured data, bulk edits to a known pattern, format conversion, pass/fail against defined criteria, summarization of a fixed template. Quality loss on smaller models is acceptable or negligible.

**No model pin, mechanical work** — burns top-tier tokens on work a smaller model handles well.

**Already pinned** — frontmatter has `model: sonnet` or `model: haiku`. Check that the pin matches the work (don't downgrade a judgment agent).

| Test result | Verdict |
|---|---|
| Genuine judgment/synthesis, no pin or already top-tier pin | KEEP |
| Mechanical work, no pin | DISPOSE-CANDIDATE (add cheaper pin) |
| Mechanical work, already pinned to cheaper model | KEEP — arbitrage already applied |
| Mixed work (judgment + mechanical phases) | KEEP top-tier; note which sub-phases could be delegated to a cheaper sub-agent (Lever 1 interaction) |

---

## DO NOT downgrade if

- The user has not explicitly agreed to trade quality on this agent — flag it as a candidate, never auto-apply.
- The agent is the sole quality gate for a high-stakes decision (trade entries, security review, architectural choices).
- The model pin would be the first pin in the project — confirm the user understands the implication before suggesting a project-wide change.
- The work is "mechanical" but the inputs are ambiguous enough that a smaller model's lower reliability could produce silent errors (e.g., mechanical LOOKS like extraction but requires domain judgment to handle edge cases).

---

## Return format

One line per flagged item:

```
<filename> → KEEP|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <suggested model pin and rationale>]
```

Example:
```
.claude/commands/precheck.md → DISPOSE-CANDIDATE: 4-agent code review against defined rubrics — mechanical; no judgment synthesis + restructure: add `model: claude-sonnet-4-5` to frontmatter; confirm quality trade-off with user before applying
.claude/commands/loop.md → KEEP: synthesis + round verdict — top-tier judgment required
.claude/commands/report.md → KEEP: synthesizes 3 reviewer perspectives into a single recommendation — judgment work
.claude/agents/reviewer.md → DISPOSE-CANDIDATE: applies a fixed rubric to flagged items — extraction + pass/fail + restructure: `model: claude-haiku-4-5`; this reviewer reads ONLY its rubric file + flagged items, no synthesis
```

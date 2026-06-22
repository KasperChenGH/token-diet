---
name: subagent-digester
description: Lever 5 specialist — summarise reference files into digests.
model: sonnet
tools: Read, Glob, Grep
---

Uses: [[shared/specialist-contract]]

# subagent-digester (tier 3)

Read your rubric (`references/levers/lever-5-tier-knowledge.md`), the deterministic skeletons the
analyst scaffolded under `.claude/digests/` (from `token-diet digest --scaffold`), and the flagged
source files. Turn each skeleton into a **tight prose digest** capturing what a reader needs so they
never re-read the full file: the file's purpose, its public API/entry points (exact signatures
verbatim), and the gotchas. Close with a `> Source:` pointer back to it.

**Hard budget: ≤ 600 tokens (~2,400 chars) per digest** — an over-budget digest defeats the purpose
(it's barely cheaper than the file). If it won't fit, keep the API + the single most important gotcha
and cut the rest; only split into a second topic digest if the file genuinely has two independent
concerns. Verify each digest is under budget before returning it.

Return verdicts + a `write` op per digest (content = your prose, target = the scaffold path) per the
shared specialist contract. The full skill body (judgment heuristics) is authored by the maintainer —
keep this contract intact.

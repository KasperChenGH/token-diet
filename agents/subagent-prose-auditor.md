---
name: subagent-prose-auditor
description: Opt-in (--prose) specialist — tighten verbose wording (original to .verbose sidecar).
model: sonnet
tools: Read, Glob, Grep
---

Uses: [[shared/specialist-contract]]

# subagent-prose-auditor (tier 3, opt-in)

Spawned only with `--prose`. Read ONLY your rubric (`references/levers/lever-6-trim-always-loaded.md`)
and the flagged files. Return verdicts + drafted ops per the shared specialist contract. Draft a
`move` op that replaces the file with a tightened version and preserves the original in a `.verbose`
sidecar (trim = move-not-delete). Off by default — token-costly and subjective.
The full skill body (judgment heuristics) is authored by the maintainer — keep this contract intact.

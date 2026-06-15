# Lever 8 — Filter Tool Output

**Question:** Is verbose command output (tests, builds, logs, large reads) dumped whole into
context, then re-sent every turn as cache reads?

## Detect
- Commands/CLAUDE.md mention test/build/log/docker with no PostToolUse output-filter hook.
- `diagnose` reports a high re-send projection (multiplier × cache_read baseline).

## Disposal rubric (per candidate)
- **KEEP** — output is already small or filtered; a hook exists.
- **MOVE** — verbose output goes to a sidecar log (`.claude/toolout/<ts>.log`) with a compressed
  view in context. token-diet ships this as a built-in engine (Bash output by default). Wire it with
  `token-diet setup` (filter in audit + a pre-commit gate), or `filter --install` → `--enable`
  (audit: records only) → `--report` → `--activate`. The `scaffold` op points the user at those.
- **DISPOSE-CANDIDATE** — n/a for tool output (never discard; always move to sidecar).

## Return format
Per the shared specialist contract. For a MOVE, draft a `scaffold` op:
`{ op: "scaffold", template: "toolout-filter", to: "scripts/toolout-filter.sh", disabled: true }`
Whether to apply the scaffold is the USER's call at the gate — recommend, don't decide.

## Blast radius
A PostToolUse hook changes EVERY tool call. Always write it disabled/commented; the user enables
and smoke-tests. Never auto-enable.

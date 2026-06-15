# subagent-analyst — private knowledge

Extra depth for the tier-2 analyst (Phase 2: measure, plan, spawn specialists, merge the
changeset). The agent contract defines the flow; this adds analyst + audit + merge discipline.

Uses: [[shared/audit-method]]
Uses: [[shared/information-preservation]]

## Merging specialist verdicts into one changeset
Specialists run independently and may touch the same file. Reconcile before emitting:
- **Same file, compatible ops** (L5 digest of a doc + L6 trim of CLAUDE.md) → keep both, ordered.
- **Same file, conflicting ops** (L6 says MOVE region, L5 says DISPOSE it) → do NOT emit both.
  Resolve by the safer verdict (MOVE beats DISPOSE) and record why the other was dropped.
- **Duplicate target** (two specialists propose the same move) → dedupe to one, note both sources.

## Provenance on every item
Each changeset item records which specialist (lever) produced it and its confidence. A reviewer
at the gate must trace any proposed edit back to the finding and rubric that justified it.

## Confidence aggregation
Roll each item up with its specialist's HIGH/MED/LOW. Surface LOW-confidence items separately at
the gate as "review first" — never bury them in an "approve all" list.

## Completeness check (don't silently drop coverage)
Before returning, verify every FLAGGED lever produced either a verdict or an explicit "no action".
If a specialist failed to spawn (nested-spawn unavailable) and you drafted inline, say so. A
missing lever is a gap to report, not an empty result to hide.

## You measure and prepare — you never edit
Write only `diet-changeset.json` + the summary. All user-config edits are the main agent's gated
`fix` step. Read `diet-history.json` and drop previously-rejected items before proposing.

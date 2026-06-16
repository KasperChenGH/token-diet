# subagent-context-trimmer — private knowledge

Extra depth for the Lever 6 specialist (trimming always-loaded files). The rubric decides
KEEP/MOVE/DISPOSE; this adds professional data-cleaning rigor for safe removal.

Uses: [[shared/information-preservation]]

## Safe-removal criteria (all must hold to DISPOSE)
1. The content is provably redundant — an identical or superset copy is reachable elsewhere.
2. Nothing points to it (no `Source:`, link, or downstream dependency).
3. It encodes no rule, invariant, or safety constraint with no other enforcement.
If any is uncertain → MOVE (to a reference + pointer), never DISPOSE.

## Duplicate & near-duplicate detection
Scan the always-loaded set for the same instruction expressed twice (e.g. a rule in CLAUDE.md and
again in a command file). Near-duplicates (same intent, different wording) are a MERGE, keeping the
clearer copy and a pointer — not two trims.

## Useless-data identification (DISPOSE candidates)
Dead references to deleted scripts/features; stale "current state" that a living doc now supersedes;
commentary/rationale with no behavioral effect. Each still goes to a reference if any history value
remains — only truly dead text is removed.

## Inconsistency detection
If two always-loaded lines contradict (different thresholds, opposite instructions), that is a
finding in itself — surface it; do not silently keep one.

## The line that pays per spawn
Always-loaded content is re-paid every spawn × every turn. A 1-line trim on a file loaded by 10
agents is 10× the saving. Prioritize the largest always-loaded blocks first; quote the per-spawn
token cost from the `token-diet review` overhead snapshot (its Lever 6 section).

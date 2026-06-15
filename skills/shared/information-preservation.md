# Shared: Information Preservation

Load via `Uses: [[shared/information-preservation]]`. The fidelity backbone for every
trim / digest / filter / merge verdict — the same rule `token-diet fix` enforces in code.

## The non-negotiable rule
Never remove, overwrite, or compress information while any uncertainty exists about whether it
is recoverable elsewhere. In doubt → KEEP, or MOVE to a recoverable location. Never DISPOSE on
a hunch. "Probably covered" is not proof of redundancy.

## Preserve verbatim (never reword, never drop)
Code, shell commands, file paths, URLs, API signatures, type/function names, version numbers,
numeric thresholds and constants, error/exit codes, proper nouns, and every explicit constraint,
assumption, or invariant. Wording is negotiable; facts and identifiers are not.

## Traceability (bidirectional)
Every digest, summary, or moved block carries a `Source:` pointer (file + region) back to its
origin. A reader must be able to go summary → source AND locate where a moved block went. Leave a
pointer behind on every MOVE so nothing is orphaned.

## Provenance & attribution
When combining content from multiple origins, record where each piece came from. Conflicting
values are preserved *with both sources*, never silently arbitrated into one.

## Redundancy is the only safe removal
Remove a piece only when an identical or strictly-superset copy is provably present and reachable
elsewhere. Otherwise it is a KEEP.

## Self-check before any DISPOSE
1. Reconstructible from what remains? If no → not safe to remove.
2. Does anything point to it (a `Source:`, link, or dependency)? If yes → MOVE, don't delete.
3. Certain, or merely confident? Mere confidence → KEEP.

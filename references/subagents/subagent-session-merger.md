# subagent-session-merger — private knowledge

Extra depth for the Lever 2 specialist (merging sessions). The rubric decides whether to merge;
this adds professional data-merging discipline for HOW to merge without losing information.

Uses: [[shared/information-preservation]]

## Treat a merge like a dataset merge
When two phases collapse into one session, their state files (handover, findings, plan) merge.
Apply: conflict resolution, schema alignment, provenance, and a recorded change log.

## Conflict resolution (when phases write overlapping state)
- Same key, same value → keep one.
- Same key, different value → KEEP BOTH with their source phase noted; never silently pick one.
- Source prioritization only by an explicit, recorded rule (e.g. "later phase wins for status
  fields") — and log that the earlier value was superseded, don't erase it.

## Preserve the contamination boundary as a hard stop
If either phase needs a fresh, uncontaminated context (adversarial review, independent
verification), merging is forbidden regardless of data convenience — defer to Lever 1 isolation.

## Version reconciliation & lineage
The merged handover must record which phase produced each section and in what order. A reader
must trace any merged fact back to its originating phase. Never overwrite a prior phase's record
without a logged justification.

## Unbounded-growth guard
Do not merge phases of an open-ended loop (research rounds, 20+ cycles): each round must stay a
fresh session or context fills. Merge only bounded, same-cycle phases.

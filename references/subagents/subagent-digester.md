# subagent-digester — private knowledge

Extra depth for the Lever 5 specialist (tiering reference material into digests). The rubric
decides what to digest; this adds professional summarization technique.

Uses: [[shared/information-preservation]]

## Prefer extractive over abstractive
Pull the load-bearing sentences/figures verbatim rather than paraphrasing them. Paraphrase only
connective prose. Extraction preserves facts; abstraction risks inventing or dropping them.

## Hierarchical structure
Digest top-down: a one-line topic header → the 3–7 key claims → the exact values/constraints
under each. A reader skims headers, drills only where a claim needs depth. One section per topic,
each closing with a `Source:` pointer (file + region).

## Semantic compression, not lossy compression
Remove redundancy and filler; keep every distinct fact. Two sentences saying the same thing → one.
A sentence carrying a unique number, constraint, or exception → keep it intact.

## Key-fact extraction checklist (never drop these)
Numbers, thresholds, units, date ranges, named entities, dependencies ("X requires Y"),
assumptions, exceptions ("except when…"), and contracts/signatures. If a fact would change a
decision, it belongs in the digest.

## Traceability budget
Target ≤ ~2k tokens per digest pack, but never sacrifice a fact to hit the budget — if it won't
fit, split into two topic digests rather than dropping content. Every pack must be reversible:
the `Source:` pointer lets a reader fetch the full original when a claim needs verification.

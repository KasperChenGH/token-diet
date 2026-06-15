# Shared: Specialist Contract

Every tier-3 lever specialist follows this. Load it via `Uses: [[shared/specialist-contract]]`.

## Return format
For each flagged item return ONE verdict line:
`<KEEP|MOVE|DISPOSE-CANDIDATE> <file> — <one-line reason>`
For every MOVE, also return the drafted change as a changeset op (below).

## Changeset op vocabulary (what `token-diet fix` applies)
- `move`   — from/region/to/pointer. Trims by MOVING content to a reference file; never deletes.
- `write`  — to/content. Create a new file (e.g. a digest). Provide the full content.
- `scaffold` — template/to/disabled. Write a named skeleton (filter/driver), disabled by default.
- `comment-marker` — file/anchor/text. Insert a non-destructive marker.

## The one rule
**Trim = move, never delete.** Content always lands somewhere recoverable. If you cannot express
a change as one of the four ops above without losing information, return KEEP and explain.

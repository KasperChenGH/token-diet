# Lever 5 — Tier the Knowledge

**Lever statement:** Static reference material re-read every run belongs in a digest (~2k tokens, `Source:` pointers) or archive (full file, pulled on demand). Only living state (rules, current open items, what NOT to do) belongs always-loaded.

## Trim fidelity rule

A digest may reword prose freely but must never disturb load-bearing tokens. Strip what carries no meaning — connective filler, hedging, courtesy phrasing, and anything stated more than once. Reproduce character-for-character everything an agent could act on literally: source snippets, links, file paths, shell commands, function and type names, API signatures, version strings, numeric thresholds, and proper nouns. Rule of thumb — wording is negotiable; facts, identifiers, and contracts are not.

---

## Inspect

For each flagged file, assess:
- RULES/STATE needed every run? → always-loaded candidate (Lever 6's domain)
- REFERENCE DEPTH pulled to verify a specific claim? → digest + archive
- DEAD — superseded, never referenced? → DISPOSE-CANDIDATE
- Digest already exists? Check `knowledge/digests/` for `*-digest.md`

Hot-files from `token-diet diagnose` (> 10x/day reads) are Lever 5 targets.

## Decision tests

| Test result | Verdict |
|---|---|
| Verbatim-required (contracts, exact signatures) | KEEP — do not digest |
| Reference depth, no digest yet | MOVE (create digest + Source: pointer) |
| Reference depth, digest exists and is current | DISPOSE-CANDIDATE the always-load (keep file) |
| Living state | KEEP |
| Dead doc, no active pointer | DISPOSE-CANDIDATE |

## DO NOT dispose if

- Any living doc has an active `Source:` pointer — the file stays, only the always-load reference is removed.
- The file is the only record of a confirmed finding referenced by a living doc.
- The digest does not yet exist — don't dispose the source before writing the digest.
- The file is < 50 lines — digest overhead approaches file size; keep as-is.

## Return format

```
<filename> → KEEP|MOVE|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <digest path or action>]
```

Example:
```
knowledge/MASTER_KNOWLEDGE.md → MOVE: 800-line pack re-read every run + restructure: knowledge/digests/master-digest.md; keep full file for on-demand depth
knowledge/old_experiment_log.md → DISPOSE-CANDIDATE: superseded by constraints.md; no active Source: pointer
data/API_REFERENCE.md → KEEP: exact CLI flags — digesting risks omitting critical parameter values
```

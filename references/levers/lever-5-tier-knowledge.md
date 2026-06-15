# Lever 5 — Tier the Knowledge

**Lever statement:** Static reference material re-read every run belongs in a digest (~2k tokens, `Source:` pointers) or archive (full file, pulled on demand). Only living state (rules, current open items, what NOT to do) belongs always-loaded.

---

## Inspect

Read the flagged knowledge/reference files themselves (not just their names). For each file, assess:
- Is this file's content RULES/STATE that must be followed every run? (→ always-loaded candidate, Lever 6's domain)
- Is this file REFERENCE DEPTH that agents pull to verify a specific claim? (→ digest + archive)
- Is this file DEAD — superseded, never referenced, or a one-off dump? (→ DISPOSE-CANDIDATE)
- Does the file already have a digest? Check `knowledge/digests/` for a corresponding `*-digest.md`

Also check whether agents load this file with a `Read` call every run vs. pulling it only when a named claim needs depth. Check the hot-files output from `token-diet diagnose` — files read > 10x/day are Lever 5 targets.

---

## Decision tests

**Verbatim-required content** — API signatures, exact CLI flags, contract terms, legal text, precise procedures where paraphrasing changes meaning. A digest of "call X with params A, B, C" risks omitting B.

**Reference depth** — domain background, theory, historical findings, strategy rationale. An agent needs this occasionally (when making a specific decision) but not every turn. Digest covers 95% of use; `Source:` pointer covers the 5%.

**Living state** — current constraints, what's been ruled out, open questions, current baseline. Changes between sessions. Must be current, not digested.

**Dead doc** — content that is fully superseded by a newer file, or an archived experiment result with no active pointer from any living doc.

| Test result | Verdict |
|---|---|
| Verbatim-required (contracts, exact signatures) | KEEP — do not digest |
| Reference depth, digest does not exist | MOVE (create digest + Source: pointer) |
| Reference depth, digest already exists and is current | DISPOSE-CANDIDATE the full-file always-load (keep file, remove always-load reference) |
| Living state | KEEP |
| Dead doc, no active pointer | DISPOSE-CANDIDATE |

---

## DO NOT dispose if

- Any living doc or agent has an active `Source:` pointer to this file — it is reachable on demand; the file stays, only the always-load reference is removed.
- The file is the only record of a confirmed finding (e.g., a round verdict that is referenced by the constraints doc) — it is archive, not dead.
- The digest for this file does not yet exist — do not dispose the source before the digest is written.
- The file is < 50 lines — digest overhead approaches the file size; keep it as-is.

---

## Return format

One line per flagged item:

```
<filename> → KEEP|MOVE|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <digest path or action>]
```

Example:
```
knowledge/MASTER_KNOWLEDGE.md → MOVE: 800-line reference pack re-read every run; digest covers 95% of use + restructure: create knowledge/digests/master-digest.md (~2k tokens); add Source: pointer; keep full file for on-demand depth
knowledge/old_experiment_log.md → DISPOSE-CANDIDATE: superseded by constraints.md; no active Source: pointer from any living doc
data/API_REFERENCE.md → KEEP: exact CLI flags — digesting risks omitting critical parameter values
```

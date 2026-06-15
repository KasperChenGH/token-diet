# Lever 6 — Trim the Always-Loaded

**Lever statement:** Everything in CLAUDE.md and entry-point command files loads into every agent spawn. Cut to essentials (rules, invariants, current state pointers). Move depth/detail to named reference files with a pointer. Every line removed saves tokens × spawn-count.

## Trim fidelity rule
A digest may reword prose freely but must never disturb load-bearing tokens. Strip what carries no meaning — connective filler, hedging, courtesy phrasing, and anything stated more than once. Reproduce character-for-character everything an agent could act on literally: source snippets, links, file paths, shell commands, function and type names, API signatures, version strings, numeric thresholds, and proper nouns. Rule of thumb — wording is negotiable; facts, identifiers, and contracts are not.

## Inspect
Read the full body of the flagged file. Classify each section:
- **Rule / invariant** — must be obeyed every run; losing it risks behavioral error.
- **Current state pointer** — short reference to where live state lives. Compact; must be present.
- **Workflow reminder** — HOW-to summary already covered in a linked command file.
- **Reference depth** — background, rationale, extended examples; useful occasionally, not every turn.
- **Redundant copy** — duplicates another always-loaded file.

`token-diet overhead --dir .` quantifies per-spawn cost. Use its line counts — don't re-measure.

## Decision tests

| Classification | Verdict |
|---|---|
| Rule / invariant needed every run | KEEP |
| Current state pointer (1–2 lines) | KEEP |
| Workflow reminder covered in a linked file | MOVE (remove reminder; pointer survives) |
| Reference depth (> 5 lines of background) | MOVE to `<project>-reference.md` + pointer line |
| Redundant copy of another always-loaded file | DISPOSE-CANDIDATE |
| Dead section (deprecated scripts/features) | DISPOSE-CANDIDATE |

90-line target: if > 90 lines, every block beyond essentials is a MOVE candidate. Move largest blocks first.

## DO NOT remove if

- Any session needs that line every run — moving ≠ deleting; it must land in the reference file.
- The line is a safety invariant with no other enforcement mechanism.
- The pointer to a reference file IS the content — one-line pointers are cheap; keep them.
- File is already ≤ 90 lines and overhead report flags it as low.

## Return format

```
<file> L<start>–L<end> "<heading or first words>" → KEEP|MOVE|DISPOSE-CANDIDATE: <reason> [+ restructure: <target>]
```

Example:
```
CLAUDE.md L45–L80 "Active Scripts" → MOVE: 35-line catalog; agents read scripts directly + restructure: project-reference.md#scripts; replace with 2-line pointer
CLAUDE.md L82–L95 "Deep Reference" → KEEP: compact pointer block — essentials only
commands/report.md L1–L60 → KEEP: self-contained agent contract
```

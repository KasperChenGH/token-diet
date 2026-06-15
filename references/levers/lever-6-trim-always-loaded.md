# Lever 6 — Trim the Always-Loaded

**Lever statement:** Everything in CLAUDE.md and entry-point command files loads into every agent spawn. Cut to essentials (rules, invariants, current state pointers). Move depth/detail to named reference files with a pointer. Every line removed saves tokens × spawn-count.

---

## Inspect

Read the full body of the flagged file (CLAUDE.md or a command `.md`). For each section or block of lines, classify it:

- **Rule / invariant** — a constraint that must be obeyed on EVERY session, every run (e.g., "never delete source files", "Phase 3 approval gate is non-negotiable"). Losing it risks behavioral error.
- **Current state pointer** — a short reference to where live state lives (e.g., "read HANDOVER.md first", "baseline is in results/constraints.md"). Compact; must be present.
- **Workflow reminder** — a summary of HOW to do something that is already fully described in a referenced script or command file. The agent will read the command file anyway.
- **Reference depth** — background context, full option descriptions, historical rationale, extended examples. Useful once in a while but not every turn.
- **Redundant copy** — content that exactly duplicates something in another always-loaded file (e.g., SKILL.md re-listed in CLAUDE.md).

`token-diet overhead --dir .` already quantifies the per-spawn cost. Use the line counts from that output — don't re-measure.

---

## Decision tests

| Classification | Verdict |
|---|---|
| Rule / invariant needed every run | KEEP |
| Current state pointer (compact, 1–2 lines) | KEEP |
| Workflow reminder for content covered in a linked file | MOVE (remove the reminder; the pointer survives) |
| Reference depth block (> 5 lines of background/context) | MOVE to `<project>-reference.md` + add pointer line |
| Redundant copy of another always-loaded file | DISPOSE-CANDIDATE (one canonical location; remove the copy) |
| Dead section (references deprecated scripts or removed features) | DISPOSE-CANDIDATE |

The 90-line essentials target: if the file is > 90 lines, every block beyond the essentials is a MOVE candidate until the file reaches the target. Prefer moving the largest blocks first.

---

## DO NOT remove if

- Any session actually needs that specific line on every run — "moving ≠ deleting." The line is removed from CLAUDE.md but must land in the reference file.
- The line is a safety invariant with no other enforcement mechanism (e.g., "never auto-delete user files" — if it's not here, it's nowhere).
- The pointer to a reference file IS the always-loaded content — one-line pointers are cheap; keep them.
- The file is already ≤ 90 lines and the overhead report flags it as low — this lever has no work to do here.

---

## Return format

One line per flagged section/block:

```
<file> L<start>–L<end> "<section heading or first words>" → KEEP|MOVE|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <target reference file>]
```

Example:
```
CLAUDE.md L45–L80 "Active Scripts" → MOVE: 35-line script catalog; agents read scripts directly + restructure: move to project-reference.md#scripts; replace with 2-line pointer
CLAUDE.md L82–L95 "Deep Reference" → KEEP: compact pointer block, 13 lines — essentials only
CLAUDE.md L12–L14 "TM calc" → KEEP: core invariant needed every session to anchor TM definitions
commands/report.md L1–L60 (body) → KEEP: self-contained agent contract — this is the always-loaded content for analyze sessions specifically
```

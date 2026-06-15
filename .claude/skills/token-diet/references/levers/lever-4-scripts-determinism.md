# Lever 4 — Scripts Compute, LLM Judges

**Lever statement:** Deterministic work (arithmetic, threshold checks, diff, pass/fail verdicts, format conversion, report assembly) belongs in a script kernel. The LLM reads the kernel's conclusions and judges only the surprises and the next decision.

---

## Inspect

Read the flagged command `.md` files and any `scripts/` files identified by the CLI scan. Look for:
- Phrases like "compute", "calculate", "score", "compare", "diff", "assemble", "threshold", "pass/fail" in agent bodies
- LLM steps that produce numeric outputs (win rates, margins, PnL, counts) without a script backing them
- LLM-assembled summary tables or verdict lists where the inputs are structured data
- Existing scripts in `scripts/` that already compute things — check whether the agent re-derives what the script already knows

Also check whether a verdict/score file is written by a script and then re-read by the LLM for interpretation. That is the correct pattern — confirm it's in place.

---

## Decision tests

**Deterministic computation** — given the same inputs, any two runs produce the same output with no judgment involved. Arithmetic, counting, threshold comparison, format conversion, diff generation, CSV assembly.

**Judgment call** — the "computation" requires interpreting ambiguous evidence, weighing trade-offs, or applying contextual knowledge that varies by situation. Not a script candidate.

**Fuzzy/contextual threshold** — the threshold itself is a judgment call (e.g., "is this output good enough?") even if applying the threshold once it's set is deterministic.

**Script already exists** — the flagged pattern already has a script kernel. The issue is the LLM re-deriving it instead of reading the script's output file.

| Test result | Verdict |
|---|---|
| Pure deterministic computation, no script kernel | DISPOSE-CANDIDATE (replace LLM step with script) |
| Script kernel exists but LLM re-derives anyway | DISPOSE-CANDIDATE (wire LLM to read script output) |
| Judgment call or fuzzy threshold | KEEP |
| LLM reads script output and interprets — correct pattern | KEEP |

---

## DO NOT dispose if

- The "computation" is actually a judgment call: fuzzy, contextual, or requiring domain knowledge not encodable in a rule.
- The LLM step INTERPRETS the script's output — this is the correct pattern; do not remove the interpretation step.
- The script would need to replicate complex domain logic that changes frequently (the script cost exceeds the LLM cost).
- Removing the LLM step collapses a safety check: the script catches the number, the LLM catches whether the number makes sense given recent context.

---

## Return format

One line per flagged item:

```
<agent/script reference> → KEEP|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <script kernel description>]
```

Example:
```
verdict assembly in report.md → DISPOSE-CANDIDATE: LLM assembles pass/fail rows from CSV — pure arithmetic + restructure: score.py already exists; wire report.md to read verdict_N.json instead of recomputing
delta calc in loop.md → DISPOSE-CANDIDATE: LLM computes % above baseline — 2 arithmetic ops + restructure: add margin field to score.py output; LLM reads and interprets the margin value
design-fit judgment in precheck.md → KEEP: "is this config coherent with the current baseline?" is a judgment call, not arithmetic
```

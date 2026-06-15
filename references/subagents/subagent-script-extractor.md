# subagent-script-extractor — private knowledge

Extra depth for the Lever 4 specialist (extracting deterministic compute into scripts). The
rubric decides what to extract; this adds clean-code + testing discipline for the kernel.

## Kernel design (clean code)
- **Pure function:** output depends only on inputs; no hidden state, clock, or randomness.
- **Single responsibility:** the kernel COMPUTES (arithmetic, counts, diffs, thresholds, format);
  the LLM JUDGES. Never blend the two in one step.
- **Stable output contract:** emit a typed file (JSON/CSV) with named fields the LLM reads —
  not free prose the LLM must re-parse.

## Determinism verification
Same inputs → identical output, every run. If a candidate can produce different results on
re-run, it is not deterministic and not a pure-script extraction — flag the non-determinism.

## Test the kernel (don't trust it blind)
- Unit tests for the core arithmetic + the boundary cases (empty input, zero, ties, overflow).
- Cover the thresholds explicitly (just-below / at / just-above the cutoff).
- A golden-output test pins the kernel's result so future edits can't silently drift it.

## Root-cause, don't patch
When the LLM's hand-computed number was wrong, find WHY (off-by-one, wrong denominator, double
count) and encode the fix in the kernel + a regression test — don't just correct the one number.

## Leave the judgment in
Do NOT extract the step where the LLM interprets the kernel's output ("is this number sane given
context?"). That interpretation is the safety check; the script catches the value, the LLM catches
whether it makes sense.

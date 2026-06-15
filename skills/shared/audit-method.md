# Shared: Audit Method

Load via `Uses: [[shared/audit-method]]`. Turns a verdict into evidence-backed, scored output.

## Every verdict is a claim that needs evidence
State the verdict, then cite the concrete evidence: the file + line/region, the frontmatter key,
the spawn site, the measured number. A verdict with no citation is a guess — downgrade it to a flag.

## Input → Validation → Output → Confidence
- **Input:** what you examined (files, regions, CLI outputs).
- **Validation:** the checks you ran (does it spawn? is it pinned? is it guarded? is the number
  reproduced by a script, not the LLM?).
- **Output:** the verdict + the drafted change.
- **Confidence:** HIGH / MED / LOW with a reason for anything below HIGH.

## Confidence scoring
- HIGH — direct evidence, no plausible alternative reading.
- MED — evidence is strong but one assumption is unverified; name the assumption.
- LOW — inference from indirect signals; flag for human review, never auto-apply.
When torn, take the LOWER score. A LOW-confidence DISPOSE becomes a flag, not an action.

## Consistency & contradiction checks
Cross-check each claim against the file's stated intent and against the other findings. An agent
that claims "isolation" but shares context, or claims "read-only" but holds write tools, is itself
a finding. Two findings that recommend opposite actions on the same file must be reconciled, not
both emitted.

## Risk tiering (gate the verdict by blast radius)
- CRITICAL — collapses a safety gate / approval step / sole enforcement. Never auto-apply.
- HIGH — affects every spawn or turn, or a contamination boundary.
- MED — localized and reversible.
- LOW — cosmetic.
Scale the evidence and confidence you demand to the risk tier.

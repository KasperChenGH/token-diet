# subagent-model-router — private knowledge

Extra depth for the Lever 7 specialist (routing mechanical work to cheaper models). The rubric
decides KEEP/downgrade; this adds risk assessment so a downgrade never causes silent errors.

Uses: [[shared/audit-method]]

## Task taxonomy (classify before routing)
- **Mechanical (downgrade-safe):** rubric-based review, extraction from structured data, bulk
  edits to a known pattern, format conversion, pass/fail against fixed criteria.
- **Judgment (keep top-tier):** weighing trade-offs, resolving ambiguity, synthesis across
  sources, strategy/architecture, anything where a wrong-but-plausible answer is costly.

## Silent-error risk is the real danger
A smaller model rarely fails loudly — it produces confident, wrong output. Before downgrading, ask:
if this step were silently wrong, would anything catch it? If the answer is "no downstream check,"
the risk tier rises and the downgrade needs human sign-off.

## Reliability trade-off scoring
Score each candidate: task-is-mechanical (yes/no) × has-downstream-verification (yes/no) ×
blast-radius (low/med/high). Downgrade freely only when mechanical AND verified AND low blast.
High-stakes sole gates (trade entries, security, architecture) stay top-tier regardless.

## "Mechanical" that hides judgment
Extraction with messy/edge-case inputs, or a "fixed rubric" whose edges need domain reasoning, is
NOT safely mechanical. Flag these as KEEP-with-caveat rather than a clean downgrade.

## Never auto-apply
A model pin is a quality trade the user must accept. Emit DISPOSE-CANDIDATE with the rationale and
the proposed pin; never change `model:` silently.

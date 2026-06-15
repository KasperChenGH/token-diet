# subagent-agent-auditor — private knowledge

Extra depth for the Lever 1 specialist (auditing agent spawns). The rubric defines the
KEEP/DISPOSE tests; this adds professional audit rigor.

Uses: [[shared/audit-method]]

## Evidence to cite for every agent verdict
- The spawn site (`Agent(` call / fan-out language) and its trigger guard, if any.
- The `model:` pin (or its absence) and the `tools:` surface.
- The contamination-boundary claim vs. whether the body actually enforces it.
A KEEP/DISPOSE citing none of these is unsupported — downgrade to a flag.

## Risk tiers for agent removal
- CRITICAL — sole enforcer of an approval/safety gate. Never DISPOSE → KEEP.
- HIGH — owns a contamination boundary (adversarial / independent review). Defer to Lever 2.
- MED — unconditional spawn, no justification, reversible → DISPOSE-CANDIDATE.
- LOW — duplicated/ceremonial wrapper → DISPOSE-CANDIDATE.

## Contradiction signals (each is itself a finding)
- Claims isolation but inherits/shares the parent context.
- Claims parallelism but its subtasks are sequential or data-dependent.
- Pinned top-tier while doing purely mechanical work (cross-ref Lever 7).
- "For thoroughness" with no parallelism/isolation/arbitrage payoff = textbook ceremonial.

## Establishment-tax math
Each spawn costs ~20–40k tokens to establish (context load + handoff). The agent must save more
than that per cycle to justify itself. A useful-work ratio (output ÷ context) < 0.15 means
reading-not-thinking — a strong DISPOSE signal. Quote the ratio when the CLI provides it.

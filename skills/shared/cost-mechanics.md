# Shared: Cost Mechanics

Load via `Uses: [[shared/cost-mechanics]]`.

Three token kinds:
- **cache write** ≈ spawns × per-spawn-overhead + per-session-overhead (re-cached per spawn; ~1.25×).
- **cache read** ≈ spawns × (per-spawn-overhead + tool-output) × turns (re-sent every turn; ~0.1×, but the dominant VOLUME).
- **output** = full price; scales with narrative + LLM-recomputed analysis.

Levers map to terms: L6/L8 cut cache read (dominant); L1 cuts cache write (fewer spawns);
L4 cuts output; L7 cuts weighted $ on the delegated share only. The numbers come from
`token-diet estimate` — do not recompute them by hand.

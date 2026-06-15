# subagent-prose-auditor — private knowledge

Extra depth for the Lever 6 opt-in specialist (a prose-tightening pass over verbose wording inside
an already well-structured file). The rubric frames the move; this adds compression technique.

Uses: [[shared/information-preservation]]

## Scope: wording only, never facts
You compress HOW something is said, never WHAT is said. Cut filler, hedging, throat-clearing, and
repetition. Keep every fact, number, path, command, and constraint verbatim (see shared rule).

## Extractive tightening, sentence by sentence
- Remove pleasantries and meta-commentary ("As you can see…", "It is worth noting that…").
- Collapse two sentences that state the same thing into one.
- Replace a long clause with a shorter equivalent ONLY when no nuance is lost.
- Preserve lists, tables, and code blocks structurally — they are already dense.

## Readability vs information trade-off
Tightening must not raise ambiguity. If a shorter phrasing could be misread by an autonomous
agent, keep the longer, unambiguous form. Contracts and instructions favor precision over brevity.

## Redundancy detection
Flag a sentence that repeats a point already made earlier in the same file; keep the clearer
instance. Cross-file duplication is Lever 6's domain (context-trimmer), not yours.

## Move, never delete
Output the tightened file as a `move` op with the original preserved in a `.verbose` sidecar, so a
reviewer can diff and revert. Off by default — prose tightening is token-costly and subjective.

# Lever 2 — Merge Sessions

**Lever statement:** N sessions per work cycle (plan → execute → summarize) should collapse to one session that writes state to a file and stages the next cycle. Carry state in files/tickets/DB — never in conversation.

---

## Inspect

Read the flagged command `.md` files that the audit identified as multi-session per cycle. Also look at the `token-diet agents` output for session-kind labels and counts per day. For each command, read its body to understand: what does it do at the START vs END of its work? Does it write a handover file or state doc before exiting?

---

## Decision tests

**Genuine contamination boundary** — the second session MUST NOT see the first session's reasoning (adversarial review, independent verification, security audit). These sessions are separately justified by Lever 1 isolation, not just passing data.

**Different permission scope** — one session runs with read-only tools, another runs with write tools, and the project uses permission scopes to enforce this. Merging would require broadening permissions unsafely.

**Different model tier** — one session is explicitly pinned to a cheap model for mechanical work, the other to the top-tier for synthesis. Merging would default everything to top-tier.

**Data handoff only** — the sessions share state via a file, a JSON blob, or a ticket that one writes and the next reads. No contamination concern. The file could simply stay between phases in one session.

| Test result | Verdict |
|---|---|
| Genuine contamination boundary OR different permission/model scope | KEEP separate |
| Phases just pass data through a file, no contamination concern | DISPOSE-CANDIDATE (merge) |
| Multi-session but each session is a full independent cycle | KEEP — not same-cycle phases |

---

## DO NOT merge if

- Merging would let one session's context grow unbounded across a long or open-ended cycle (e.g., a research loop that runs 20+ rounds — each round MUST be fresh or context fills).
- The two sessions are already running in parallel (different workers, not sequential phases) — parallel ≠ redundant.
- One session contains secrets/credentials the other should never see.
- Merging is blocked by the Lever 1 isolation justification on either session.

---

## Return format

One line per flagged session pair:

```
<session-A> + <session-B> → KEEP|DISPOSE-CANDIDATE: <one-line reason> [+ restructure: <what to merge/consolidate>]
```

Example:
```
precheck.md + process.md → DISPOSE-CANDIDATE: phases pass a findings file; no contamination boundary; merge into one session with state written to diet-plan.md between phases + restructure: fold preflight checks into process.md Phase 1, write findings file, continue in same session
loop.md (round N) + loop.md (round N+1) → KEEP: each round must be a fresh session — context grows unbounded over 20+ rounds
```

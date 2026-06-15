# Lever 3 — Evict In-Session Compute

**Lever statement:** Any long-running command (build, test, train, backtest, sweep, loop) running inside a session wastes all compute-adjacent tokens and risks died-while-waiting failures. Move it to a driver script between sessions.

---

## Inspect

Read the flagged command `.md` files and `CLAUDE.md` sections that reference long-running commands. Specifically look for:
- Direct shell invocations of build/test/train/backtest/sweep commands inside the agent body
- Language like "run", "execute", "wait for", "babysit" applied to multi-minute processes
- The `token-diet agents` idle-gap report (sessions with gaps > 10 min indicate babysitting)
- Any `while/until` polling loops inside the agent body

Also check `scripts/` for existing driver scripts — the fix may already be partially done.

---

## Decision tests

**Long-running with no LLM decision mid-run** — the command runs, produces output, and the LLM reads the output afterward. The LLM contributes nothing while the command runs. This is pure babysitting.

**Long-running with LLM decision mid-run** — the command pauses and asks the LLM to decide something at an intermediate step (e.g., "should I continue this search or stop?"). The LLM is genuinely interactive mid-run.

**Short command (< 30 seconds)** — not a compute eviction candidate; the overhead of a driver script exceeds any token saving.

**Polling loop inside session** — agent polls a background process with `sleep` + re-check. Always MOVE — the driver script handles the poll.

| Test result | Verdict |
|---|---|
| Long-running, no LLM decision mid-run | MOVE (to driver script) |
| Long-running with genuine LLM mid-run decision | KEEP in-session |
| Short command (< 30s) | KEEP — eviction overhead exceeds saving |
| Polling loop | MOVE |

DISPOSE-CANDIDATE is not applicable here — the work must happen somewhere. This is always a MOVE verdict.

---

## DO NOT evict if

- The command is genuinely interactive: it emits partial results the LLM must inspect to decide whether to continue, what parameters to adjust, or whether to abort.
- The command is short enough that session overhead dominates (< 30 seconds typical runtime).
- The command IS the driver script itself (already evicted — just confirm it's called from outside the session).

---

## Return format

One line per flagged item:

```
<command-reference> → KEEP|MOVE: <one-line reason> [+ restructure: <driver script skeleton description>]
```

Example:
```
sweep command in process.md → MOVE: backtest sweep runs 5–20 min with no LLM mid-run decisions + restructure: scripts/run_batch.sh — call batch_job.py, write output to results/result.csv, session resumes after
poll loop in loop.md → MOVE: sleep+check loop burns tokens across idle minutes + restructure: driver polls build workers; session triggers on completion file
report.md inline scoring → KEEP: LLM inspects partial results per round to decide next config — genuinely interactive
```

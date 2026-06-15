# subagent-compute-evictor — private knowledge

Extra depth for the Lever 3 specialist (evicting in-session compute to drivers). The rubric
decides MOVE vs KEEP; this adds the engineering for a driver that won't lose work.

## A driver script is production code — design it that way
- **Idempotent:** safe to re-run after a crash; detect already-done work and skip it.
- **Checkpoint/resume:** write progress to a results/state file so a restart resumes, not restarts.
- **Explicit exit codes:** 0 = success; non-zero = a specific failure the session can branch on.
- **Output contract:** write results to a known path (CSV/JSON) the next session reads — never
  rely on scrollback or stdout that scrolls away.

## Where the compute belongs
- One-shot long job → a shell/Python driver invoked between sessions.
- Recurring/scheduled → CI step or cron.
- Many independent units → a job queue / batch runner, not a session loop.

## Failure handling (the point of eviction)
The session must survive the driver dying. Persist partial results; on resume, the session reads
the state file and continues. Never let a multi-minute job hold an LLM turn open ("died while
waiting" is the failure mode you are removing).

## Keep in-session only when genuinely interactive
If the command emits partial results the LLM must inspect to choose the next parameter or abort,
it is interactive — KEEP. Pure run-then-read-output is always a MOVE.

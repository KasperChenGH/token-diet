# subagent-output-filter — private knowledge

Extra depth for the Lever 8 specialist (filtering verbose tool output). The rubric drafts the
scaffold; this adds cleaning + extraction technique for what the filter should keep vs compress.

Uses: [[shared/information-preservation]]

## Extract the signal, compress the rest
From verbose stdout, keep the load-bearing facts and compress the filler:
- **Tests:** failures + error messages + the final pass/fail count; drop per-test "ok" lines.
- **Builds:** errors + warnings + the result; drop progress/percentage spam.
- **git/status:** the one-line summary; drop unchanged-file noise.
- **Large reads:** signatures / structure / the requested region; drop the bulk body.

## Noise removal & dedup
Collapse repeated identical log lines to `<line> (×N)`. Strip ANSI codes, timestamps, and
progress bars that carry no decision value. Deduplicate stack frames repeated across retries.

## Never discard — always sidecar
Full output goes to `.claude/toolout/<ts>.log`; the context gets the compressed view + a pointer
to the sidecar. This is trim = move, not delete: a failure the filter compressed must still be
fully recoverable from the log.

## Failure-biased filtering
When in doubt about a line, KEEP it if it could indicate a failure (error/exception/non-zero exit).
Over-compressing a stack trace that explains a bug is the costly mistake — bias toward preserving
anything diagnostic.

## High blast radius
A PostToolUse hook rewrites EVERY tool call. Draft it disabled; the user enables and smoke-tests.
Never auto-enable a filter that could hide a real error.

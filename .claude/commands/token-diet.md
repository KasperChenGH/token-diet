---
name: token-diet
description: Run the token-diet agent on the current project to measure, diagnose, and reduce LLM token spend. Usage: /token-diet [days] or /token-diet status
---

# /token-diet [days]

Spawns the token-diet agent on the current project. The agent runs Phases 0-3 (measure → diagnose → plan → present for approval) then stops for your approval before touching any files.

**Default window:** 7 days. Override with a number: `/token-diet 14` uses `--days 14`.

```
Usage:
  /token-diet           — full flow, 7-day window
  /token-diet 14        — full flow, 14-day window
  /token-diet status    — audit + overhead summary only (read-only, no plan)
```

## /token-diet [days] — full flow

Spawn the token-diet agent (agent type: `token-diet` if available, otherwise inline the contract from `~/.claude/agents/token-diet.md` or `~/.claude/skills/token-diet/SKILL.md`) on the current project directory.

Pass the days argument (default 7) through to the agent's Phase 1 and Phase 2 commands.

Relay the agent's enriched plan back to the user for approval. Do not execute Phase 4 until the user approves specific items.

## /token-diet status — read-only audit

If the user types `/token-diet status`, do not spawn the full agent. Instead run these two commands directly and summarize the output in under 20 lines:

```
token-diet audit --days 7
token-diet overhead --dir .
```

Report: avg output/day, avg calls/day, per-spawn overhead tokens, top 3 flagged sessions (if any). No plan, no edits.

## Note on first run

If `token-diet` is not installed, the agent will ask before running `npm install -g github:KasperChenGH/token-diet`. Approve that step to proceed.

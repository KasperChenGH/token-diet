# token-diet demo — rendered automatically by .github/workflows/demo.yml (vhs-action) → docs/demo.gif
# To render locally instead:  (from the repo root)  mkdir -p docs && vhs demo/token-diet.tape
#
# Story (≈30s), leading with the result:
#   1. filter --report — a measured reduction TABLE (sample output run through the Lever 8 filter) — the hook
#   2. review          — scorecard across the 8 levers + a letter grade (where the waste is)
#   3. estimate        — the projected savings if you fix the flagged levers

Output docs/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1120
Set Height 760
Set Padding 22
Set Theme "Dracula"
Set TypingSpeed 45ms

# ── hidden setup: isolate HOME (so only the sample project's findings show), define a
#    clean `token-diet` command, (re)build the fixture, then cd into the demo dir ──
Hide
Type "export HOME=$(mktemp -d); export USERPROFILE=$HOME"
Enter
Type 'BIN="$PWD/bin/token-diet.js"; token-diet(){ node "$BIN" "$@"; }'
Enter
Type "node demo/make-fixture.js >/dev/null"
Enter
Type "node demo/seed-report.js >/dev/null"
Enter
Type "cd demo"
Enter
Type "clear"
Enter
Show

# ── Beat 1 (the hook): the measured reduction TABLE — sample tool output through the Lever 8 filter ──
Type "token-diet filter --report --dir ./sample-project"
Sleep 600ms
Enter
Sleep 6s

# ── Beat 2: diagnose — score a wasteful project against all 8 levers (no history needed) ──
Type "clear"
Enter
Sleep 300ms
Type "token-diet review --dir ./sample-project"
Sleep 600ms
Enter
Sleep 5s

# ── Beat 3: quantify — what fixing the flagged levers saves ──
Type "clear"
Enter
Sleep 300ms
Type "token-diet estimate --dir ./sample-project"
Sleep 600ms
Enter
Sleep 5s

Sleep 1500ms

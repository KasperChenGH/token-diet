# token-diet demo — rendered automatically by .github/workflows/demo.yml (vhs-action) → docs/demo.gif
# To render locally instead:  (from the repo root)  mkdir -p docs && vhs demo/token-diet.tape
#
# Story (≈30s): a deliberately wasteful sample project →
#   1. review     — scorecard across the 8 levers + a letter grade
#   2. estimate   — the projected savings if you fix the flagged levers
#   3. filter --self-test — the output filter compressing real tool output

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
Type "cd demo"
Enter
Type "clear"
Enter
Show

# ── Beat 1: diagnose — score a wasteful project against all 8 levers (no history needed) ──
Type "token-diet review --dir ./sample-project"
Sleep 600ms
Enter
Sleep 5s

# ── Beat 2: quantify — what fixing the flagged levers saves ──
Type "clear"
Enter
Sleep 300ms
Type "token-diet estimate --dir ./sample-project"
Sleep 600ms
Enter
Sleep 5s

# ── Beat 3: the output filter compressing real tool output (failures-only, structural JSON) ──
Type "clear"
Enter
Sleep 300ms
Type "token-diet filter --self-test"
Sleep 600ms
Enter
Sleep 5s

Sleep 1500ms

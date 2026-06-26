# Demo render kit

Generates the README demo GIF. **No screen/self recording** — `vhs` reads the `.tape` *script*
and renders the GIF headlessly.

- `make-fixture.js` — generates a deliberately token-wasteful `sample-project/` (gitignored) so the
  demo shows a real grade + findings. (token-diet's own repo grades A → dull demo.)
- `token-diet.tape` — the [vhs](https://github.com/charmbracelet/vhs) script. Renders `docs/demo.gif`.

## How it's produced

**Automatically, in CI.** `.github/workflows/demo.yml` runs on demand (and when this folder changes),
renders the GIF with `charmbracelet/vhs-action`, and commits `docs/demo.gif`. You don't run anything.

To trigger a re-render: GitHub → **Actions** → **Demo GIF** → **Run workflow** (or just edit the tape
and push).

**Locally (optional)** — needs `vhs` + `node`:
```bash
mkdir -p docs
vhs demo/token-diet.tape      # → docs/demo.gif
```

The demo arc (~30s): **review** (scorecard + grade) → **estimate** (projected savings) →
**filter --self-test** (live tool-output compression).

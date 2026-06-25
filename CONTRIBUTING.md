# Contributing to token-diet

Thanks for your interest in improving token-diet. Issues and pull requests are welcome.

## Ground rules

token-diet carries its own methodology, so two house rules are non-negotiable:

1. **Zero runtime dependencies.** The CLI uses only the Node.js standard library — no npm
   packages. Keep it that way; a dependency-free tool is part of the product.
2. **Determinism in the CLI, judgment in the LLM.** All measuring, counting, compressing, and
   applying is plain deterministic code with tests. The LLM is only ever asked to *judge*.
3. **Every trim is a move, never a delete.** When the tool restructures a file, content moves to
   an on-demand reference with a pointer left behind — information is never lost irrecoverably.
   This is an invariant, enforced and tested in `src/fix.js`.

## Development

```bash
git clone https://github.com/KasperChenGH/token-diet.git
cd token-diet
npm test            # = `node --test` (zero deps; no install step needed)
```

The test suite must pass before a change is merged. New behavior needs new tests — the safety-
critical surface (anything that writes a file or rewrites live tool output) is expected to stay at
high coverage.

## Pull requests

- Keep changes focused; one logical change per PR.
- Update `CHANGELOG.md` (the `[Unreleased]` section) and any affected docs (`README.md`,
  `skills/SKILL.md`, lever/subagent references) so docs and code stay in sync.
- Run `npm test` and confirm it's green.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

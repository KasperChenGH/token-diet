# Security Policy

## Supported versions

token-diet is distributed from the `master` branch and the latest published release. Security
fixes are applied to the latest version only; please upgrade before reporting an issue against an
older one.

| Version | Supported |
|---------|-----------|
| 0.9.x   | ✅        |
| < 0.9   | ❌        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use GitHub's private vulnerability reporting instead: go to the repository's **Security** tab →
**Report a vulnerability**. This opens a private advisory visible only to the maintainers.

When reporting, please include:

- a description of the issue and its impact,
- the version (or commit) affected,
- steps to reproduce, and
- any proof-of-concept, logs, or suggested fix.

You can expect an acknowledgement within **14 days**. We will keep you informed as the report is
triaged and a fix is prepared, and will credit you in the advisory unless you prefer otherwise.

## Scope notes

token-diet has **zero runtime dependencies** (Node.js standard library only), which keeps its
supply-chain surface small. Its hooks (`filter`, `readgate`) are **fail-safe and off by default** —
any error preserves the host's original behavior — and they only ever read/compress local data and
write under `.claude/`. The most security-relevant surfaces are therefore: the file-writing kernel
(`src/fix.js`, path-escape guarded), the hook entry points (`src/filter.js`, `src/readgate.js`), and
the install/setup commands that edit `.claude/settings.json`. Reports touching those are especially
welcome.

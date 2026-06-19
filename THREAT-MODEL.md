# Threat model: `taskbounty-check`

A local scanner for GitHub Actions and CI maintenance hygiene. This document states the security
properties it must uphold and how. It has not undergone an external paid security review; it is an
open, dependency-free tool you can audit yourself (start with `src/net.js`, `src/fsscan.js`, and
`src/sanitize.js`).

## Core promise (must be technically true)

> Scan repositories locally. Source code and workflow contents never leave your machine. The only
> thing that can leave is a sanitized counts-only summary, and only when you explicitly ask.

## Assets

- A1: your source code, workflow contents, secrets, tokens, local paths
- A2: your GitHub session (`gh` CLI) and any PAT
- A3: the sanitized summary (counts + labels only) you may choose to share
- A4: the published npm package supply chain

## Trust boundaries

- B1: filesystem to CLI process (we read only inside selected roots)
- B2: CLI process to network (default: no egress; opt-in only)
- B3: npm registry to your machine (provenance + checksums protect A4)

## Threats and mitigations

| # | Threat | Mitigation |
|---|--------|-----------|
| T1 | Source/workflow contents leak over the network | No egress by default (`src/net.js` replaces `fetch` with a throwing stub). No upload path in the tool. |
| T2 | Path traversal outside selected roots | Every path is resolved and confined to a selected root via a realpath prefix check; anything escaping is rejected. |
| T3 | Symlink escapes the root | Symlinks whose realpath leaves the root are skipped, never followed. |
| T4 | Reading secrets / credentials / SSH keys / `.env` | Strict allowlist: only `.github/workflows/*.yml|yaml` and update-automation config are opened. Nothing else. |
| T5 | Sanitized summary contains forbidden data | `toSanitizedSummary()` builds an allowlisted object from scratch; `assertSanitizedSummarySafe()` rejects forbidden keys/patterns. |
| T6 | Executing repo code / installing deps | Never. Pure file read plus a deterministic regex scan. No execution, no install, no spawn. |
| T7 | Reading or transmitting the `gh`/PAT token | `--gh-org` shells out to your existing `gh` session for the repo list only; the token is never read by this tool and never transmitted. |
| T8 | Resource exhaustion on huge repos | File-count, per-file size, and wall-clock limits; partial-report state when exceeded. |
| T9 | Supply-chain compromise of the package | Zero runtime dependencies; published with npm provenance; pinned-version invocation documented (`npx taskbounty-check@<exact-version>`). |
| T10 | GitHub Action leaks detail into CI logs | `--github-summary` writes only sanitized aggregates to `$GITHUB_STEP_SUMMARY`; no filenames, evidence, or workflow contents; uploads nothing. |
| T11 | Telemetry / phone-home | None. |

## What the tool reads / writes / transmits

- Reads: only the allowlisted workflow + updater files inside selected roots.
- Writes: a local HTML + JSON report (and a sanitized `*.summary.json` only with `--share`). In
  `--github-summary` mode, only a counts summary appended to the CI job summary.
- Transmits: nothing by default. See PRIVACY.md.

## Reporting

See SECURITY.md.

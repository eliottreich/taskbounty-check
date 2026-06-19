# taskbounty-check

Pre-launch safety check for AI-built apps. Built it with **Lovable, Bolt, Replit, Cursor, or v0**?
This scans your **GitHub Actions + CI hygiene locally** before you ship. Your source code and
workflow contents **never leave your machine**. Network is **off by default**.

> **Scope, honestly:** this checks GitHub Actions workflow + update-automation hygiene. It does
> **not** check exposed secrets, auth, payments, webhooks, or runtime behavior — those need a
> manual review. It is a maintenance check, not a full security audit.

> **Upload status:** automatic upload (`--share` → API) is disabled during the pilot. `--share`
> only produces a sanitized summary for you to paste into TaskBounty.

```bash
# scan the current repo (no network, writes a local report)
npx taskbounty-check@latest .

# reproducible, pinned invocation (recommended)
npx taskbounty-check@<exact-version> .
```

## GitHub Action

Add the check to a pull-request workflow with read-only permissions:

```yaml
name: TaskBounty Check

on: [pull_request]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
      - uses: eliottreich/taskbounty-check@v1
```

The Action writes a sanitized counts-only summary to the GitHub job summary. It uploads nothing,
reads no secrets, and does not fail the build.

## What it does

- Reads only your GitHub Actions workflow files and update-automation config, scans them
  in-process with a deterministic ruleset (the same rules as the public checker), and writes a
  local HTML + JSON report. It does **not** execute workflows, install dependencies, or run any
  repository code.

## Modes

| Mode | Command | Network |
|------|---------|---------|
| Single repo | `npx taskbounty-check .` | none |
| Directory of repos | `npx taskbounty-check ./all-repos` | none |
| Explicit paths | `npx taskbounty-check --manifest repos.json` | none |
| GitHub org (your `gh` session) | `npx taskbounty-check --gh-org <org>` | **yes, opt-in** |

`--gh-org` uses your existing `gh` CLI session to fetch each repo's workflow files **to this
machine** (read-only). Your GitHub token is never read by this tool and never sent to TaskBounty.

## What is read, written, transmitted

Run `--explain-data` to print this at any time.

- **Reads (allowlist — nothing else is opened):** `<repo>/.github/workflows/*.yml|*.yaml` and
  update-automation config (`dependabot.yml`/`renovate.json*`). Never source files, `.env`,
  secrets, SSH keys, credential stores, or anything outside the selected repository roots.
  Symlinks that escape a root are skipped, never followed.
- **Writes (local only):** `<out>.json` (full detail) and `<out>.html`.
- **Transmits:** nothing by default. `--share` produces a *sanitized summary* (scan id, label, candidate
  counts by category, private-review **count**, scanner version, timestamps; repo names only with
  `--include-repo-names`) that you copy and paste into TaskBounty yourself. Automatic upload is
  disabled during the pilot.

## Flags

`--share` · `--gh-org <org>` · `--manifest <file>` · `--org-label <label>` ·
`--include-repo-names` · `--dry-run` · `--explain-data` · `--delete-local-report` ·
`--no-network` (default unless `--share`/`--gh-org`) · `--out <basename>` · `--version` · `--help`

## Want help interpreting or fixing these results?

Request a free 20-minute launch-safety review:
https://www.task-bounty.com/ai-app-security-check/review

**TaskBounty receives nothing unless you submit that form.** The scan runs locally and the full
report stays on your machine; the review form gives us no access to your repositories, source,
workflows, or secrets.

## Security

Zero runtime dependencies. Published with npm provenance; verify checksums. See
[THREAT-MODEL.md](THREAT-MODEL.md), [SECURITY.md](SECURITY.md), and [PRIVACY.md](PRIVACY.md).

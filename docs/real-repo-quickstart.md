# Add a local GitHub Actions maintenance check in five minutes

This guide runs `taskbounty-check` against a real repository, explains the output, and shows how
to keep the check in CI. The scan is local by default: it reads GitHub workflow and update-bot
configuration, executes no repository code, and uploads nothing.

The example repository is [`eliottreich/taskbounty-check`](https://github.com/eliottreich/taskbounty-check),
which uses the same command in its own CI.

## 1. Try a local dry run

Clone the example repository, then run the pinned package version:

```bash
git clone https://github.com/eliottreich/taskbounty-check.git
cd taskbounty-check
npx -y taskbounty-check@0.1.6 . --dry-run
```

Expected output for version `0.1.6`:

```text
[dry-run] 1 repos · 2 workflow files · 0 maintenance candidates · 0 for private review
[dry-run] would write local report files only (actions-check-report.json and actions-check-report.html); nothing would be uploaded.
```

`--dry-run` performs the scan but writes no report. Remove it to create local HTML and JSON files.

## 2. Understand what was checked

The scanner looks only at:

- `.github/workflows/*.yml` and `.github/workflows/*.yaml`
- Dependabot and Renovate configuration

It checks GitHub Actions maintenance hygiene such as mutable third-party action references,
workflow token permissions, and whether update automation is configured. Context-dependent
patterns are counted separately for private review rather than described publicly.

It does **not** inspect application source, `.env` files, secrets, authentication, payments,
webhooks, or runtime behavior. It is a focused maintenance check, not a penetration test or a
complete security audit.

Run this any time to see the exact data boundary:

```bash
npx -y taskbounty-check@0.1.6 --explain-data
```

## 3. Add it to GitHub Actions

Add this step after checkout in an existing workflow:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v4
  - run: npx -y taskbounty-check@0.1.6 . --github-summary --no-network
```

The check writes a counts-only summary to the workflow run. It does not post comments, open pull
requests, upload source, or send telemetry.

For GitHub Code Scanning annotations, use the
[`examples/code-scanning.yml`](https://github.com/eliottreich/taskbounty-check/blob/main/examples/code-scanning.yml)
example instead.

## 4. Use it from an AI coding agent

The package also exposes a local MCP server:

```bash
npx -y taskbounty-check@0.1.6 mcp
```

Cursor, Claude Code, and Codex can call `scan_repo`, explain a finding, and generate a text-only fix
plan. The server does not modify files or make outbound requests.

## 5. Decide what happens next

- No findings: keep the pinned CI check and update it deliberately.
- Maintenance candidates: review the local report and make the smallest justified change.
- Private-review count: do not publish speculative details; review the workflow context privately.

Need a human second opinion? [Request a free launch-safety review](https://www.task-bounty.com/ai-app-security-check/review?utm_source=github&utm_medium=tutorial&utm_campaign=taskbounty_check_quickstart).
Submitting that form grants TaskBounty no repository access.

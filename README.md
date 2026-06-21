# taskbounty-check

Pre-launch safety check for AI-built apps. Built it with **Lovable, Bolt, Replit, Cursor, or v0**?
This scans your **GitHub Actions + CI hygiene locally** before you ship. Your source code and
workflow contents **never leave your machine**. The default code path makes **no outbound
requests**; `fetch` is additionally blocked as defense in depth (this is not a complete network
sandbox). Only `--gh-org` intentionally uses the network.

> **Scope, honestly:** this checks GitHub Actions workflow + update-automation hygiene. It does
> **not** check exposed secrets, auth, payments, webhooks, or runtime behavior — those need a
> manual review. It is a maintenance check, not a full security audit.

> **`--share` uploads nothing.** It writes a sanitized, counts-only local file for you to submit
> **manually**; network stays off under `--share`.

## Quick start (60 seconds)

```bash
# 1. Scan the current repo locally (no network, writes a local report)
npx taskbounty-check@latest .

# 2. SARIF for GitHub Code Scanning
npx taskbounty-check@latest . --format sarif --output taskbounty.sarif

# 3. Scaffold a least-privilege CI workflow (previews; never overwrites)
npx taskbounty-check@latest init

# 4. Local MCP server for Codex / Claude Code / Cursor
npx taskbounty-check@latest mcp
```

Reproducible, pinned invocation (recommended): `npx taskbounty-check@0.1.4 .`

**Privacy:** the scan runs locally and **sends nothing by default**. Source code, workflow
contents, filenames, line numbers, and evidence never leave your machine. The only thing that can
ever be transmitted is a sanitized counts-only summary, and only when you explicitly choose to.

## Supported checks (and honest limitations)

**Checks (GitHub Actions + CI maintenance hygiene):**
- Third-party actions pinned to a movable tag/branch instead of a commit SHA
- Broad (write-all) workflow token permissions
- Missing explicit `permissions:` block
- Update automation (Dependabot/Renovate) presence
- Context-dependent workflow patterns flagged for private review (e.g. `pull_request_target`, script injection)

**Does NOT check** (these need a manual review): exposed secrets, auth/authorization, payments,
webhooks, runtime behavior. It is a maintenance/hygiene check, **not** a full security audit or a
penetration test.

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
- **Transmits:** nothing by default. **`--share` uploads nothing** — it writes a *sanitized,
  counts-only* file (scan id, label, candidate counts by category, private-review **count**,
  scanner version, timestamps; repo names only with `--include-repo-names`) for you to submit
  **manually**. Network stays off under `--share`. Only `--gh-org` intentionally uses the network.

## Flags

`--share` · `--gh-org <org>` · `--manifest <file>` · `--org-label <label>` ·
`--include-repo-names` · `--dry-run` · `--explain-data` · `--delete-local-report` ·
`--no-network` (default everywhere except `--gh-org`) · `--out <basename>` · `--version` · `--help`

## Want help interpreting or fixing these results?

Request a free 20-minute launch-safety review:
https://www.task-bounty.com/ai-app-security-check/review?utm_source=npm&utm_medium=npm_readme&utm_campaign=workflow_security

**TaskBounty receives nothing unless you submit that form.** The scan runs locally and the full
report stays on your machine; the review form gives us no access to your repositories, source,
workflows, or secrets.

## GitHub Code Scanning (SARIF)

Emit SARIF 2.1.0 and surface findings in your repo's Security → Code scanning tab:

```bash
npx taskbounty-check@latest . --format sarif --output taskbounty.sarif
```

The SARIF carries deterministic rule ids (`taskbounty/<rule>`), severity levels, and file/line
references — **no source contents, secrets, or environment values**, and no network access.
Confirmed findings are emitted as `kind: fail`; lower-confidence items as `kind: review`.

Help interpreting SARIF results: https://www.task-bounty.com/ai-app-security-check/review?utm_source=github&utm_medium=sarif_docs&utm_campaign=workflow_security

Upload it with the official action (full example in [`examples/code-scanning.yml`](examples/code-scanning.yml)):

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@v4
  - run: npx taskbounty-check@latest . --format sarif --output taskbounty.sarif
  - uses: github/codeql-action/upload-sarif@v3
    with:
      sarif_file: taskbounty.sarif
```

## Local agent (MCP)

Run a **local** stdio MCP server so Codex, Claude Code, or Cursor can scan and reason about findings
in your editor. It runs locally, makes **zero outbound network requests**, uploads no source, and
**never modifies files** — `generate_fix_plan` returns a plan as text for you to apply yourself.

```bash
npx taskbounty-check@latest mcp
```

Tools: `scan_repo` (local scan summary), `explain_finding` (plain-language explanation), `generate_fix_plan` (text fix plan).

Want a human to review the plan? https://www.task-bounty.com/ai-app-security-check/review?utm_source=mcp&utm_medium=mcp_docs&utm_campaign=workflow_security

**Cursor** — `.cursor/mcp.json`:
```json
{ "mcpServers": { "taskbounty-check": { "command": "npx", "args": ["-y", "taskbounty-check@latest", "mcp"] } } }
```

**Claude Code**:
```bash
claude mcp add taskbounty-check -- npx -y taskbounty-check@latest mcp
```

**Codex** — in `~/.codex/config.toml`:
```toml
[mcp_servers.taskbounty-check]
command = "npx"
args = ["-y", "taskbounty-check@latest", "mcp"]
```

## Security

Zero runtime dependencies. Published with npm provenance; verify checksums. See the threat model
(`design-docs/security-cli-threat-model.md`) and external-review packet
(`design-docs/security-expansion/external-review-packet.md`) in the project repository.

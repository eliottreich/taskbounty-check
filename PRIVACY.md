# Privacy and data handling

`taskbounty-check` is built so your source never leaves your machine. This document states exactly
what it reads, what it writes, and what (if anything) it transmits. You can print the same summary
at any time with `--explain-data`.

## What it reads

An allowlist only. Nothing else is ever opened:

- `<repo>/.github/workflows/*.yml` and `*.yaml`
- update-automation config: `.github/dependabot.yml|yaml`, `renovate.json(5)`, `.renovaterc(.json)`

It never reads your application source, `.env` files, secrets, SSH keys, credential stores, or
anything outside the directories you point it at. Symlinks that escape a selected root are skipped,
never followed.

## What it writes

Local files only, in your working directory:

- `<out>.json` (full detail, stays on your machine)
- `<out>.html` (human-readable local report)
- `<out>.summary.json` (only when you run `--share`)

`--delete-local-report` removes the report files when you are done. In `--github-summary` mode it
writes no files at all and only appends a counts summary to the CI job summary.

## What it transmits

By default, nothing. Network is off.

- `--gh-org <org>`: uses your existing `gh` CLI session to fetch an org's workflow files to your
  machine (read-only). Your GitHub token is never read by this tool and never sent anywhere.
- `--share`: produces a sanitized summary (scan id, label, candidate counts by category,
  private-review count, scanner version, timestamps) for you to paste somewhere yourself. It is
  printed and saved locally. The tool does not upload it.

No source code, workflow contents, filenames, line numbers, secrets, tokens, file paths, or
evidence are ever included in anything the tool transmits or in a shared summary.

## Telemetry

None. The tool does not phone home.

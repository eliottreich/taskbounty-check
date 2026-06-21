# Syncing this CLI to the public repo + releasing

## Authoritative source & sync discipline (read first)

- **`packages/security-check-cli/` in the monorepo is the authoritative DEVELOPMENT source.**
  All changes land here first (reviewed, voice-checked, tested).
- **[`eliottreich/taskbounty-check`](https://github.com/eliottreich/taskbounty-check) is the
  public DISTRIBUTION + publish mirror** (npm OIDC/provenance + the Marketplace Action). It already
  exists, is public, and has published releases. Do **not** create another repo.
- **Never hand-edit the public repo's `src/` directly.** It only changes via a sync PR FROM the
  monorepo. This is the rule that keeps the two from drifting.
- **Before every release, verify parity:** the public `src/` and `test/` must equal the monorepo
  copies (excluding `parity.test.ts`, which is monorepo-only). `diff -r` them; the only intended
  differences are `package.json` `repository.url` (public points at the standalone repo) and the
  version field. If anything else differs, sync before publishing.
- Versions are immutable on npm — always `npm view taskbounty-check version` and pick the next
  semver; never re-publish an existing one.

This directory is the reviewed source. Changes flow monorepo → public repo via a PR, then a release.

## What syncs into the public repo

```
src/*.js                   # incl. sarif.js, init.js, mcp.js
test/cli.test.ts test/sarif.test.ts test/init.test.ts test/mcp.test.ts
examples/code-scanning.yml
README.md SECURITY.md PRIVACY.md CONTRIBUTING.md THREAT-MODEL.md action.yml
.github/workflows/ci.yml   # test (npm ci / npm test / npm pack) + Action self-check
```

EXCLUDE: `test/parity.test.ts` (monorepo-only; imports the app via `@/`), `LISTING.md`, this file.

In the public repo's `package.json`, keep its existing fields — especially
`"repository": { "url": "https://github.com/eliottreich/taskbounty-check.git" }` (do NOT overwrite
with the monorepo URL) — and set `"version"` to the new release and `"test": "vitest run"` (so the
new SARIF/init/MCP tests run, not just cli.test.ts).

## Release flow (founder)

Substitute `<NEXT_VERSION>` with the next semver (do not reuse a published version — npm versions
are immutable; check `npm view taskbounty-check version` first).

1. Open a PR in the public repo with the synced changes + `version: <NEXT_VERSION>`. Let CI go green
   (test + Action self-check). Merge.
2. Publish via the existing OIDC/provenance workflow:
   `gh workflow run "Publish npm package" --repo eliottreich/taskbounty-check` (runs `npm ci`,
   `npm test`, `npm pack --dry-run`, `npm publish` with `id-token: write` provenance).
3. Verify: `npm view taskbounty-check version` → `<NEXT_VERSION>`; `npx taskbounty-check@<NEXT_VERSION> --help`.
4. Create the `v<NEXT_VERSION>` GitHub release. Move the `v1` tag to the verified release commit only
   after the published-package and Action self-checks pass.

## Secret scan (before any release)

```bash
grep -rInE "(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)" src test *.md *.yml .github 2>/dev/null || echo "clean"
```
(The `ghp_NEVER-READ` fixture in `test/cli.test.ts` is intentional and not a real token.)

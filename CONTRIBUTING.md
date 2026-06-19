# Contributing

Thanks for your interest in `taskbounty-check`.

## Principles (please preserve these)

1. **Zero runtime dependencies.** The published package must stay dependency-free.
2. **No network by default.** Any network path must be opt-in and clearly documented.
3. **Strict read allowlist.** Only workflow files and update-automation config are ever read.
4. **Sanitized output only leaves the machine when the user explicitly asks.** Counts and labels
   only, never source, filenames, line numbers, or evidence.

A change that weakens any of these will not be accepted.

## Development

```bash
npm install        # dev dependencies (vitest) only; no runtime deps
npm test           # runs the safety + behavior tests
node src/index.js --help
node src/index.js <path> --explain-data
```

## Tests

`test/cli.test.ts` covers root confinement, symlink-escape rejection, the read denylist, the
sanitizer allowlist, the static review CTA URL, HTML escaping, and the sanitized GitHub step
summary. Please add a test with any behavior change.

## Pull requests

- Keep changes small and focused.
- Run `npm test` and `npm pack --dry-run` before opening a PR.
- Describe the user-facing effect and confirm the four principles above still hold.

// `taskbounty-check init` — scaffold a least-privilege, SHA-pinned GitHub Actions workflow that
// runs the check on every PR and writes a sanitized job summary. Safety: previews before writing,
// requires confirmation unless --yes, NEVER overwrites an existing file, is idempotent, and never
// commits/pushes/comments/opens a PR.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

export const WORKFLOW_RELPATH = ".github/workflows/taskbounty-check.yml";

// actions/checkout pinned to a commit SHA (v4.2.2). Least-privilege: contents: read only.
export const WORKFLOW_CONTENT = `# Added by \`npx taskbounty-check init\`. GitHub Actions + CI maintenance hygiene on every PR.
# Local-only check: it reads your workflow config on the runner and writes a sanitized job
# summary. It does not upload source, comment on PRs, or open issues.
name: TaskBounty Check

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  taskbounty-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - run: npx taskbounty-check@latest . --github-summary --no-network
`;

/**
 * Plan an init for a repo directory. Pure (no writes). Returns the target path, whether it already
 * exists (never overwrite), whether the dir looks like a git repo, and the proposed content.
 */
export function planInit(dir = ".") {
  const root = resolve(dir);
  const targetPath = join(root, WORKFLOW_RELPATH);
  return {
    root,
    targetPath,
    exists: existsSync(targetPath),
    isRepo: existsSync(join(root, ".git")),
    hasWorkflowsDir: existsSync(join(root, ".github", "workflows")),
    content: WORKFLOW_CONTENT,
  };
}

/** Write the workflow. NEVER overwrites; returns 'written' | 'exists'. Caller handles confirm. */
export function writeInit(plan) {
  if (plan.exists) return "exists"; // idempotent: never overwrite
  mkdirSync(dirname(plan.targetPath), { recursive: true });
  writeFileSync(plan.targetPath, plan.content);
  return "written";
}

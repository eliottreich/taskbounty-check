// `taskbounty-check init` — scaffold a least-privilege, SHA-pinned GitHub Actions workflow that
// runs the check on every PR and writes a sanitized job summary. Safety: previews before writing,
// requires confirmation unless --yes, NEVER overwrites an existing file, is idempotent, and never
// commits/pushes/comments/opens a PR.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

export const WORKFLOW_RELPATH = ".github/workflows/taskbounty-check.yml";

// Every action is pinned to a full commit SHA (supply-chain safety) — no @latest, no movable
// tags. The TaskBounty Action is pinned to a verified release commit; checkout to a release SHA.
// Least-privilege: contents: read only.
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
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
      - uses: eliottreich/taskbounty-check@8b5fa6b2b9f33e4bbd9670823b2c678efe31e404 # v0.1.3
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

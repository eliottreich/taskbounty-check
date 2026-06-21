import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planInit, writeInit, WORKFLOW_RELPATH, WORKFLOW_CONTENT } from "../src/init.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tbinit-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("init workflow generation", () => {
  it("the generated workflow is least-privilege and SHA-pinned", () => {
    expect(WORKFLOW_CONTENT).toContain("permissions:\n  contents: read");
    // SHA-pinned action (40-hex), not a tag/branch
    expect(WORKFLOW_CONTENT).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(WORKFLOW_CONTENT).toContain("--github-summary");
    expect(WORKFLOW_CONTENT).toContain("--no-network");
    // does nothing privileged
    expect(WORKFLOW_CONTENT).not.toMatch(/security-events:|pull-requests:\s*write|issues:\s*write/);
  });

  it("planInit reports target path and non-existence on a fresh repo", () => {
    const plan = planInit(dir);
    expect(plan.targetPath).toBe(join(dir, WORKFLOW_RELPATH));
    expect(plan.exists).toBe(false);
  });

  it("writes the workflow when absent", () => {
    const plan = planInit(dir);
    expect(writeInit(plan)).toBe("written");
    expect(readFileSync(join(dir, WORKFLOW_RELPATH), "utf8")).toBe(WORKFLOW_CONTENT);
  });

  it("never overwrites an existing file (idempotent)", () => {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, WORKFLOW_RELPATH), "# user's own workflow\n");
    const plan = planInit(dir);
    expect(plan.exists).toBe(true);
    expect(writeInit(plan)).toBe("exists");
    // untouched
    expect(readFileSync(join(dir, WORKFLOW_RELPATH), "utf8")).toBe("# user's own workflow\n");
  });

  it("is idempotent across repeated runs", () => {
    writeInit(planInit(dir));
    const second = writeInit(planInit(dir));
    expect(second).toBe("exists");
    expect(existsSync(join(dir, WORKFLOW_RELPATH))).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_TOOLS, callMcpTool } from "../src/mcp.js";

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "tbmcp-"));
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "on: push\npermissions: write-all\n      - uses: tj-actions/changed-files@v47\n");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("local MCP tools", () => {
  it("exposes exactly the three documented tools", () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(["explain_finding", "generate_fix_plan", "scan_repo"]);
  });

  it("scan_repo returns a text summary of a local repo", () => {
    const r = callMcpTool("scan_repo", { path: repo });
    expect(r.content[0].type).toBe("text");
    expect(r.content[0].text).toMatch(/Maintenance candidates|Local scan/);
    expect(r.content[0].text).toContain("nothing uploaded");
  });

  it("explain_finding returns plain-language text for a known rule", () => {
    const r = callMcpTool("explain_finding", { rule: "unpinned-action" });
    expect(r.content[0].text).toMatch(/movable tag|Why it matters/i);
  });

  it("generate_fix_plan returns a text plan and never claims to modify files", () => {
    const r = callMcpTool("generate_fix_plan", { rule: "broad-permissions" });
    expect(r.content[0].text).toMatch(/Fix plan/);
    expect(r.content[0].text).toMatch(/does not modify files/i);
  });

  it("unknown rule is handled gracefully", () => {
    const r = callMcpTool("explain_finding", { rule: "nope" });
    expect(r.content[0].text).toMatch(/Unknown rule/);
  });
});

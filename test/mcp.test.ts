import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { MCP_TOOLS, callMcpTool, PKG_VERSION, REVIEW_CTA, __resetCtaForTest } from "../src/mcp.js";

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

  it("serverInfo version is read from package.json (never a stale literal)", () => {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
    expect(PKG_VERSION).toBe(pkg.version);
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

describe("scan_repo product-led CTA (quiet, shown once, on findings only)", () => {
  const cleanRepo = mkdtempSync(join(tmpdir(), "tbclean-"));
  beforeAll(() => {
    __resetCtaForTest();
    mkdirSync(join(cleanRepo, ".github", "workflows"), { recursive: true });
    // a clean workflow: pinned action + explicit least-privilege permissions => no findings
    writeFileSync(join(cleanRepo, ".github", "workflows", "ci.yml"),
      "on: push\npermissions:\n  contents: read\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n");
  });
  afterAll(() => rmSync(cleanRepo, { recursive: true, force: true }));

  it("never shows the CTA when there are no findings", () => {
    const r = callMcpTool("scan_repo", { path: cleanRepo });
    expect(r.content[0].text).not.toContain("Need a human second opinion");
  });

  it("shows the CTA once when there are findings, with the mcp_registry utm and no private data", () => {
    const first = callMcpTool("scan_repo", { path: repo }).content[0].text;
    expect(first).toContain("Need a human second opinion or fix plan?");
    expect(first).toContain("utm_source=mcp_registry&utm_medium=integration&utm_campaign=agent_distribution");
    // the CTA is the static constant; it carries no repo name, path, finding, or count
    expect(REVIEW_CTA).not.toMatch(/owner|\.github|\.yml|\/tmp|count/i);

    // shown ONCE: a second findings scan in the same process does not repeat it
    const second = callMcpTool("scan_repo", { path: repo }).content[0].text;
    expect(second).not.toContain("Need a human second opinion");
  });
});

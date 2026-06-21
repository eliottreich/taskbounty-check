import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REVIEW_CTA } from "../src/mcp.js";
import { renderSarif } from "../src/lib.js";
import { auditWorkflows } from "../src/scanner.js";
import { buildNormalizedResult } from "../src/report.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Each distribution surface must carry its own attribution channel so the funnel can tell them
// apart. These assert the EXACT utm triples the website's classifyChannel maps to a channel.
describe("distribution surfaces carry their matching attribution", () => {
  it("agent skill → skills_sh/agent_skill", () => {
    const skill = read("skills/taskbounty-security/SKILL.md");
    expect(skill).toContain("utm_source=skills_sh&utm_medium=agent_skill&utm_campaign=agent_distribution");
  });

  it("README Marketplace/Action section → github/marketplace", () => {
    expect(read("README.md")).toContain("utm_source=github&utm_medium=marketplace&utm_campaign=agent_distribution");
  });

  it("README npm reader section → npm/npm_readme (kept separate from Marketplace)", () => {
    expect(read("README.md")).toContain("utm_source=npm&utm_medium=npm_readme");
  });

  it("MCP scan_repo CTA → mcp_registry/integration", () => {
    expect(REVIEW_CTA).toContain("utm_source=mcp_registry&utm_medium=integration&utm_campaign=agent_distribution");
  });

  it("SARIF rule helpUri → github/sarif", () => {
    const result = buildNormalizedResult({
      repos: [{ repoName: "owner/repo", audit: auditWorkflows([{ path: ".github/workflows/ci.yml", text: "on: push\npermissions: write-all\n      - uses: tj-actions/changed-files@v47" }], "owner/repo"), updater: null, workflowCount: 1, partial: false, failed: false }],
      orgLabel: null, scanId: "abc", generatedAt: "2026-06-21T00:00:00Z",
    });
    const sarif = renderSarif(result);
    const helpUris = sarif.runs[0].tool.driver.rules.map((r: { helpUri: string }) => r.helpUri);
    expect(helpUris.length).toBeGreaterThan(0);
    for (const u of helpUris) expect(u).toContain("utm_source=github&utm_medium=sarif&utm_campaign=agent_distribution");
  });
});

import { describe, it, expect } from "vitest";
import { renderSarif } from "../src/lib.js";
import { auditWorkflows } from "../src/scanner.js";
import { buildNormalizedResult } from "../src/report.js";

function resultWith(text: string) {
  return buildNormalizedResult({
    repos: [{ repoName: "owner/repo", audit: auditWorkflows([{ path: ".github/workflows/ci.yml", text }], "owner/repo"), updater: null, workflowCount: 1, partial: false, failed: false }],
    orgLabel: null, scanId: "abc", generatedAt: "2026-06-21T00:00:00Z",
  });
}

describe("renderSarif", () => {
  const sarif = renderSarif(resultWith("on: push\npermissions: write-all\n      - uses: tj-actions/changed-files@v47"));

  it("is valid SARIF 2.1.0 with one run and a named driver", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toContain("sarif-schema-2.1.0");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe("taskbounty-check");
    expect(Array.isArray(sarif.runs[0].tool.driver.rules)).toBe(true);
  });

  it("uses deterministic taskbounty/<rule> rule ids referenced by results", () => {
    const ids = sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ids.every((id: string) => id.startsWith("taskbounty/"))).toBe(true);
    for (const res of sarif.runs[0].results) {
      expect(ids).toContain(res.ruleId);
    }
  });

  it("maps severity to levels and distinguishes confirmed findings from review suggestions", () => {
    const results = sarif.runs[0].results;
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(["error", "warning", "note"]).toContain(r.level);
      expect(["fail", "review"]).toContain(r.kind);
      expect(typeof r.properties.confirmed).toBe("boolean");
      if (r.kind === "review") expect(r.level).toBe("note");
    }
  });

  it("emits file + line locations where available", () => {
    const withLoc = sarif.runs[0].results.find((r: { locations?: unknown[] }) => r.locations);
    expect(withLoc).toBeTruthy();
    const loc = withLoc.locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toContain(".github/workflows/");
    if (loc.region) expect(typeof loc.region.startLine).toBe("number");
  });

  it("contains no source contents, secrets, or environment values", () => {
    const blob = JSON.stringify(sarif);
    // messages are short rule descriptions; assert no obvious secret/env leakage shapes
    expect(blob).not.toMatch(/ghp_[A-Za-z0-9]{20,}|-----BEGIN|process\.env|AWS_SECRET|password=/i);
  });

  it("is deterministic for the same input", () => {
    const a = JSON.stringify(renderSarif(resultWith("on: push\npermissions: write-all")));
    const b = JSON.stringify(renderSarif(resultWith("on: push\npermissions: write-all")));
    expect(a).toBe(b);
  });
});

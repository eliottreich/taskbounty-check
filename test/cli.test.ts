import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepoRoots, scanInput, toSanitizedSummary, assertSanitizedSummarySafe, reviewCtaUrl, renderHtml, buildNormalizedResult } from "../src/lib.js";
import { auditWorkflows as cliAudit } from "../src/scanner.js";
import { installNoNetworkGuard, restoreNetwork } from "../src/net.js";

let dir: string;
let repo: string;
let outsideSecret: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sccli-"));
  repo = join(dir, "repo");
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  // a real workflow with a flaggable third-party action
  writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "on: push\n      - uses: tj-actions/changed-files@v47\n");
  // sensitive files that MUST never be read
  writeFileSync(join(repo, ".env"), "API_KEY=supersecret-NEVER-READ\n");
  writeFileSync(join(repo, "secrets.txt"), "TOKEN=ghp_NEVER-READ\n");
  writeFileSync(join(repo, "index.js"), "// SOURCE-CODE-NEVER-READ\nconsole.log(1)\n");
  // a secret OUTSIDE the repo root, plus a symlink inside workflows pointing to it
  outsideSecret = join(dir, "outside-secret.yml");
  writeFileSync(outsideSecret, "STOLEN=outside-root-NEVER-READ\n");
  try { symlinkSync(outsideSecret, join(repo, ".github", "workflows", "evil.yml")); } catch { /* symlink may be unavailable */ }
});

afterAll(() => { restoreNetwork(); rmSync(dir, { recursive: true, force: true }); });

describe("CLI strict allowlist + confinement", () => {
  it("only reads .github/workflows yaml — never .env, secrets, or source", () => {
    const result = scanInput(repo);
    const blob = JSON.stringify(result);
    expect(blob).not.toContain("supersecret");
    expect(blob).not.toContain("ghp_NEVER-READ");
    expect(blob).not.toContain("SOURCE-CODE-NEVER-READ");
    // it DID scan the real workflow
    expect(result.safePublic.mutableThirdPartyRefCount).toBeGreaterThanOrEqual(1);
  });

  it("never follows a symlink that escapes the repo root", () => {
    const result = scanInput(repo);
    const blob = JSON.stringify(result);
    expect(blob).not.toContain("outside-root-NEVER-READ");
    expect(blob).not.toContain("STOLEN");
  });
});

describe("no-network guard (--no-network / default)", () => {
  it("blocks outbound fetch and a scan still completes", () => {
    installNoNetworkGuard();
    try {
      expect(() => (globalThis.fetch as unknown as () => void)()).toThrow(/network is disabled/i);
      const result = scanRepoRoots([repo]); // pure fs; no network
      expect(result.repoCount).toBe(1);
    } finally {
      restoreNetwork();
    }
  });
});

describe("sanitized summary", () => {
  it("contains only allowlisted fields; no source/evidence/paths/private detail", () => {
    const result = scanInput(repo);
    // give it a private finding to ensure only the COUNT surfaces
    result.privateReviewCount = 2;
    result.localEvidence.push({ category: "workflow_security_checks", severity: "critical", file: "x/.github/workflows/y.yml", line: 3, detail: "pull_request_target untrusted", fix: "do not" });
    const s = toSanitizedSummary(result);
    expect(() => assertSanitizedSummarySafe(s)).not.toThrow();
    const blob = JSON.stringify(s);
    expect(blob).not.toContain("pull_request_target");
    expect(blob).not.toContain(".github/workflows");
    expect(s).not.toHaveProperty("localEvidence");
    expect(s).not.toHaveProperty("repoNames");
    expect(s.privateReviewCount).toBe(2);
  });
});

describe("no-network by default", () => {
  it("installNoNetworkGuard makes any fetch throw, and a scan still works", () => {
    installNoNetworkGuard();
    try {
      expect(() => (globalThis as unknown as { fetch: () => void }).fetch()).toThrow();
      const r = scanInput(repo); // pure fs read; must not need network
      expect(r.repoCount).toBeGreaterThan(0);
    } finally {
      restoreNetwork();
    }
  });
});

describe("review CTA URL is static and clean", () => {
  it("contains no repository, finding, count, or evidence data", () => {
    const url = reviewCtaUrl("post_scan");
    expect(url).toBe("https://www.task-bounty.com/ai-app-security-check/review?utm_source=taskbounty_check&utm_medium=cli&utm_campaign=ai_app_security_check&utm_content=post_scan");
    // only host + fixed utm params + a sanitized placement label
    expect(url).not.toMatch(/repo|owner|finding|candidate|secret|token|\.ya?ml|count=|evidence/i);
  });
  it("sanitizes the placement label (no injection of arbitrary data)", () => {
    expect(reviewCtaUrl("../../etc/passwd?x=1")).toMatch(/utm_content=etcpasswdx1$/);
  });
});

describe("HTML report escapes malicious repository names", () => {
  it("does not emit raw script tags from a hostile repo name", () => {
    const result = buildNormalizedResult({
      repos: [{ repoName: "<script>alert(1)</script>", audit: { findings: [], exploit: [], strongHygiene: [], contextHygiene: [] }, updater: null, workflowCount: 1, partial: false, failed: false }],
      orgLabel: "<img src=x onerror=alert(1)>", scanId: "abc", generatedAt: "2026-06-19T00:00:00Z",
    });
    const html = renderHtml(result);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert(1)</script>");
    // the hostile org label is HTML-escaped in the output
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("GitHub Action is read-only and self-contained", () => {
  it("runs the bundled source, uploads nothing, and requests no write", () => {
    const yml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
    expect(yml).toContain("$GITHUB_ACTION_PATH/src/index.js"); // bundled source, no runtime download
    expect(yml).toContain("--github-summary");
    expect(yml).toContain("--no-network");
    expect(yml).not.toMatch(/upload-artifact|actions\/upload/i); // never uploads reports/artifacts
    expect(yml).not.toMatch(/\bwrite\b/i); // requests no write permission
  });
});

describe("CLI version", () => {
  it("reports the published package name and version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const output = execFileSync(process.execPath, [new URL("../src/index.js", import.meta.url).pathname, "--version"], {
      encoding: "utf8",
    }).trim();
    expect(output).toBe(`taskbounty-check@${pkg.version}`);
  });
});

describe("github step summary is sanitized aggregates only", () => {
  it("contains counts/labels but no filenames, line numbers, or evidence", async () => {
    const { renderGithubSummary } = await import("../src/lib.js");
    const result = buildNormalizedResult({
      repos: [{
        repoName: "owner/secret-app",
        audit: cliAudit([{ path: ".github/workflows/a.yml", text: "on: push\npermissions: write-all\n      - uses: tj-actions/changed-files@v47" }], "owner/secret-app"),
        updater: null, workflowCount: 1, partial: false, failed: false,
      }],
      orgLabel: null, scanId: "abc", generatedAt: "2026-06-19T00:00:00Z",
    });
    const md = renderGithubSummary(result);
    expect(md).toContain("| Maintenance category | Count |");
    // no filenames, repo names, file:line refs, or exploit markers (category labels like
    // "token_permissions" are fine — we check for real leakage vectors only).
    expect(md).not.toMatch(/\.ya?ml|owner\/secret-app|\.github\/workflows|onerror|alert\(/i);
  });
});

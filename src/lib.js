// Programmatic scan API (no network, no execution). Used by the CLI and tests.

import { randomBytes } from "node:crypto";
import { discoverRepoRoots, scanRepoRoot } from "./fsscan.js";
import { auditWorkflows } from "./scanner.js";
import { buildNormalizedResult } from "./report.js";

export { toSanitizedSummary, assertSanitizedSummarySafe, isSanitizedSummarySafe } from "./sanitize.js";
export { renderHtml, buildNormalizedResult } from "./report.js";
export { SCANNER_VERSION } from "./scanner.js";

export function newScanId() {
  return randomBytes(9).toString("hex");
}

// Conversion CTA. STATIC by construction: only a fixed placement label varies. The CLI must never
// put repository names, findings, filenames, counts, or evidence in this URL.
const REVIEW_BASE = "https://www.task-bounty.com/ai-app-security-check/review";
export function reviewCtaUrl(content = "post_scan") {
  const placement = String(content).replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "post_scan";
  return `${REVIEW_BASE}?utm_source=taskbounty_check&utm_medium=cli&utm_campaign=ai_app_security_check&utm_content=${placement}`;
}
export const REVIEW_CTA_TEXT = "Want help interpreting or fixing these results? Request a free 20-minute launch-safety review.";

import { toSanitizedSummary } from "./sanitize.js";

// Render a SANITIZED markdown aggregate for $GITHUB_STEP_SUMMARY. Counts/labels only — never
// filenames, line numbers, evidence, workflow contents, or sensitive findings. Built from the
// allowlisted sanitized summary so nothing sensitive can leak into CI output.
export function renderGithubSummary(result) {
  const s = toSanitizedSummary(result, { includeRepoNames: false });
  const cats = Object.entries(s.safeCandidateCountsByCategory || {});
  const rows = cats.length
    ? cats.map(([k, n]) => `| ${String(k).replace(/[|`<>]/g, "")} | ${Number(n) || 0} |`).join("\n")
    : "| (none) | 0 |";
  return [
    "### TaskBounty: GitHub Actions maintenance check",
    "",
    `Repositories: **${s.repoCount}** · workflow files reviewed across the scan · items for private review: **${s.privateReviewCount}**`,
    "",
    "| Maintenance category | Count |",
    "| --- | --- |",
    rows,
    "",
    "_Counts only. Source, filenames, line numbers, and evidence stay on the runner and are never uploaded._",
    "_Scope: GitHub Actions + update-automation hygiene. Not a full security audit (secrets/auth/payments/webhooks/runtime need manual review)._",
    "_Help interpreting or fixing these: https://www.task-bounty.com/ai-app-security-check/review_",
    "",
  ].join("\n");
}

/** Scan an array of repo roots (already resolved). Pure fs read + regex; no network. */
export function scanRepoRoots(roots, opts = {}) {
  const repos = roots.map((root) => {
    const r = scanRepoRoot(root, opts.repoLabelFor ? opts.repoLabelFor(root) : null);
    const audit = auditWorkflows(r.workflowFiles, r.repoName);
    return { repoName: r.repoName, audit, updater: r.updater, workflowCount: r.workflowFiles.length, partial: r.partial, failed: false };
  });
  return buildNormalizedResult({
    repos,
    orgLabel: opts.orgLabel ?? null,
    scanId: opts.scanId ?? newScanId(),
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    repoNames: opts.includeRepoNames ? repos.map((r) => r.repoName) : undefined,
  });
}

/** Scan from a single input path (a repo, or a directory of repos). */
export function scanInput(inputPath, opts = {}) {
  const roots = discoverRepoRoots(inputPath);
  return scanRepoRoots(roots, opts);
}

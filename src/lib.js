// Programmatic scan API (no network, no execution). Used by the CLI and tests.

import { randomBytes } from "node:crypto";
import { discoverRepoRoots, scanRepoRoot } from "./fsscan.js";
import { auditWorkflows } from "./scanner.js";
import { buildNormalizedResult } from "./report.js";

export { toSanitizedSummary, assertSanitizedSummarySafe, isSanitizedSummarySafe } from "./sanitize.js";
export { renderHtml, buildNormalizedResult } from "./report.js";
export { renderSarif } from "./sarif.js";
export { SCANNER_VERSION } from "./scanner.js";

export function newScanId() {
  return randomBytes(9).toString("hex");
}

// Network policy. ONLY --gh-org intentionally uses the network (it fetches an org's workflow files
// via the user's gh session). Default scanning and --share are local: --share writes a sanitized
// file for manual submission and uploads nothing, so it keeps the no-network guard. `networking`
// true => the run is allowed network; `conflict` true => --no-network was combined with --gh-org.
export function resolveNetworkPolicy(flags = {}) {
  const networking = Boolean(flags.ghOrg);
  return { networking, conflict: Boolean(flags.noNetwork && networking) };
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

// Friendly label + recommended next step per safe category. Counts only; no file/line detail.
const CATEGORY_INFO = {
  third_party_pinning: { label: "Third-party action pinning", next: "Pin third-party actions to a full commit SHA instead of a movable tag/branch." },
  token_permissions: { label: "Workflow token permissions", next: "Add an explicit least-privilege `permissions:` block (contents: read by default)." },
  dependency_update_automation: { label: "Update automation", next: "Add a github-actions entry to Dependabot or Renovate to keep pins current." },
  workflow_security_checks: { label: "Workflow security checks", next: "Review the flagged workflow patterns with a maintainer." },
  repository_maintenance_config: { label: "Repository maintenance config", next: "Review repository automation/config hygiene." },
};

// Single tracked help link. utm only identifies the channel — never a repo name or any finding.
const ACTION_HELP_URL =
  "https://www.task-bounty.com/ai-app-security-check/review?utm_source=github&utm_medium=action_summary&utm_campaign=workflow_security";

// Render a SANITIZED markdown summary for $GITHUB_STEP_SUMMARY. Counts/labels only — never
// filenames, line numbers, evidence, workflow contents, repo names, or sensitive findings. Built
// from the allowlisted sanitized summary so nothing sensitive can leak into CI output.
export function renderGithubSummary(result) {
  const s = toSanitizedSummary(result, { includeRepoNames: false });
  const cats = Object.entries(s.safeCandidateCountsByCategory || {}).filter(([, n]) => Number(n) > 0);

  const rows = cats.length
    ? cats.map(([k, n]) => {
        const info = CATEGORY_INFO[k] || { label: String(k).replace(/[|`<>]/g, ""), next: "Review with a maintainer." };
        return `| ${info.label} | ${Number(n) || 0} | ${info.next} |`;
      }).join("\n")
    : null;

  const out = [
    "### TaskBounty: GitHub Actions maintenance check",
    "",
    "**What was checked:** GitHub Actions workflow + update-automation hygiene across this repository (public configuration only, on the runner).",
    "",
    `**Reviewed:** ${s.repoCount} repo(s) · maintenance candidates surfaced: ${cats.reduce((a, [, n]) => a + (Number(n) || 0), 0)} · items for private review: ${s.privateReviewCount}`,
    "",
  ];

  if (rows) {
    out.push(
      "| Category | Count | Recommended next step |",
      "| --- | --- | --- |",
      rows,
      "",
    );
  } else {
    out.push("No maintenance candidates surfaced in the categories checked. ✅", "");
  }

  out.push(
    "**Limitations (honest):** this is a maintenance/hygiene check of GitHub Actions + repo config, not a full security audit. It does **not** check exposed secrets, auth, payments, webhooks, or runtime behavior, which need a manual review. Counts only; source, filenames, line numbers, and evidence stay on the runner and are never uploaded.",
    "",
    `➡️ **[Get help reviewing or fixing these findings](${ACTION_HELP_URL})**`,
    "",
  );
  return out.join("\n");
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

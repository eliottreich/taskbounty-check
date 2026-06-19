// Builds the NormalizedResult from per-repo audit results and renders the LOCAL report (HTML +
// JSON). The local report includes full evidence (localEvidence) — it is written to the user's
// machine only and is never uploaded. Only toSanitizedSummary() output may ever be transmitted.

import { SCANNER_VERSION } from "./scanner.js";

const RULE_CATEGORY = {
  "unpinned-action": "third_party_pinning",
  "broad-permissions": "token_permissions",
  "no-permissions-block": "token_permissions",
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** repos: [{ repoName, audit, updater, workflowCount, partial, failed }] */
export function buildNormalizedResult({ repos, orgLabel = null, scanId, generatedAt, repoNames }) {
  let workflowFilesReviewed = 0, completed = 0, failed = 0, partial = 0;
  let mutableThirdPartyRefCount = 0, missingPermissionsBlocks = 0, writeAll = false, privateReviewCount = 0;
  const candidateCounts = {};
  const localEvidence = [];

  for (const r of repos) {
    if (r.failed) { failed += 1; continue; }
    completed += 1;
    if (r.partial) partial += 1;
    workflowFilesReviewed += r.workflowCount ?? 0;
    const a = r.audit;
    for (const f of a.strongHygiene) {
      const cat = RULE_CATEGORY[f.rule] ?? "other";
      candidateCounts[cat] = (candidateCounts[cat] ?? 0) + 1;
      if (f.rule === "unpinned-action") mutableThirdPartyRefCount += 1;
    }
    for (const f of a.contextHygiene) {
      if (f.rule === "no-permissions-block") missingPermissionsBlocks += 1;
      const cat = RULE_CATEGORY[f.rule] ?? "other";
      if (cat !== "other") candidateCounts[cat] = (candidateCounts[cat] ?? 0) + 1;
    }
    if (a.strongHygiene.some((f) => f.rule === "broad-permissions")) writeAll = true;
    privateReviewCount += a.exploit.length;
    // local-only full evidence (every finding, incl. exploit detail)
    for (const f of [...a.strongHygiene, ...a.contextHygiene, ...a.exploit]) {
      localEvidence.push({ category: RULE_CATEGORY[f.rule] ?? (f.class === "exploit" ? "workflow_security_checks" : "other"), severity: f.severity, file: `${r.repoName}/${f.file}`, line: f.line ?? null, detail: f.detail, fix: f.fix });
    }
  }

  const maintenanceCandidates = Object.entries(candidateCounts).map(([category, count]) => ({
    category, count, confidence: category === "token_permissions" ? "candidate" : "observed",
  }));
  const updaterDetected = repos.some((r) => !r.failed && r.updater);
  const positivePractices = [];
  if (updaterDetected) positivePractices.push("An Actions update automation (Dependabot/Renovate) is configured.");
  if (!writeAll) positivePractices.push("No workflow grants full write-all token scope.");
  if (mutableThirdPartyRefCount === 0) positivePractices.push("No third-party actions on mutable tags were found.");

  return {
    scanId, scannerVersion: SCANNER_VERSION, generatedAt, orgLabel,
    repoCount: repos.length, completed, failed, partial, workflowFilesReviewed,
    safePublic: { updaterDetected, mutableThirdPartyRefCount, permissionHygiene: { writeAll, missingPermissionsBlocks }, positivePractices },
    maintenanceCandidates,
    privateReviewCount,
    privateEvidence: [], // the CLI keeps exploit detail in localEvidence (on the user's machine); not duplicated here
    localEvidence,
    ...(repoNames ? { repoNames } : {}),
  };
}

export function renderHtml(result) {
  const rows = result.localEvidence
    .map((e) => `<tr><td>${esc(e.category)}</td><td>${esc(e.severity)}</td><td><code>${esc(e.file)}${e.line ? ":" + e.line : ""}</code></td><td>${esc(e.detail)}</td><td>${esc(e.fix)}</td></tr>`)
    .join("\n");
  const cands = result.maintenanceCandidates.map((c) => `<li>${esc(c.category)}: <strong>${c.count}</strong> (${esc(c.confidence)})</li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>GitHub Actions maintenance report${result.orgLabel ? " — " + esc(result.orgLabel) : ""}</title>
<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#0f172a}h1{font-size:1.5rem}code{font-size:.85em}table{border-collapse:collapse;width:100%;margin-top:1rem}th,td{border-bottom:1px solid #e2e8f0;text-align:left;padding:.4rem .6rem;vertical-align:top;font-size:.9rem}.muted{color:#64748b}.box{border:1px solid #e2e8f0;border-radius:8px;padding:1rem;margin:1rem 0}</style></head>
<body>
<h1>GitHub Actions maintenance report</h1>
<p class="muted">Local report. Source code and workflow contents never left your machine. Scanner ${esc(result.scannerVersion)} · ${esc(result.generatedAt)}</p>
<div class="box"><strong>${result.repoCount}</strong> repositories · <strong>${result.completed}</strong> completed · <strong>${result.failed}</strong> failed · <strong>${result.partial}</strong> partial · <strong>${result.workflowFilesReviewed}</strong> workflow files reviewed</div>
<div class="box"><strong>Maintenance candidates:</strong><ul>${cands || "<li>none</li>"}</ul>
<strong>Items for private review:</strong> ${result.privateReviewCount}
<p class="muted">Positive practices: ${result.safePublic.positivePractices.map(esc).join("; ") || "—"}</p></div>
<h2>Findings (local detail)</h2>
<table><thead><tr><th>Category</th><th>Severity</th><th>Location</th><th>Detail</th><th>Suggested fix</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No findings.</td></tr>'}</tbody></table>
<hr><p class="muted">Want help interpreting or fixing these results? Request a free 20-minute launch-safety review at https://www.task-bounty.com/ai-app-security-check/review?utm_source=taskbounty_check&amp;utm_medium=cli&amp;utm_campaign=ai_app_security_check&amp;utm_content=html_report . TaskBounty receives nothing unless you submit that form: this report stays on your machine.</p>
</body></html>`;
}

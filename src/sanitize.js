// Sanitized-summary builder + guard — the ONLY data that may ever be uploaded. Mirrors the app's
// src/lib/security-check/normalized.ts. Built from an allowlist (never spreads the raw result);
// the guard rejects any forbidden field. This is the enforcement point for "source never leaves".

const FORBIDDEN_KEY_PATTERNS = [
  /source/i, /content/i, /file/i, /path/i, /line/i, /secret/i, /token/i,
  /evidence/i, /commit/i, /membership/i, /detail/i, /fix/i, /workflow/i,
];
const ALLOWED = new Set([
  "scanId", "orgLabel", "repoCount", "completed", "failed", "partial",
  "scannerVersion", "generatedAt", "safeCandidateCountsByCategory", "privateReviewCount", "repoNames",
]);
const DATA_CONTAINERS = new Set(["safeCandidateCountsByCategory"]);

/** Build the shareable summary from an allowlist. includeRepoNames is opt-in only. */
export function toSanitizedSummary(result, opts = {}) {
  const safeCandidateCountsByCategory = {};
  for (const c of result.maintenanceCandidates) {
    safeCandidateCountsByCategory[c.category] = (safeCandidateCountsByCategory[c.category] ?? 0) + c.count;
  }
  const summary = {
    scanId: result.scanId,
    orgLabel: result.orgLabel,
    repoCount: result.repoCount,
    completed: result.completed,
    failed: result.failed,
    partial: result.partial,
    scannerVersion: result.scannerVersion,
    generatedAt: result.generatedAt,
    safeCandidateCountsByCategory,
    privateReviewCount: result.privateReviewCount,
  };
  if (opts.includeRepoNames && result.repoNames && result.repoNames.length) {
    summary.repoNames = result.repoNames.slice(0, 1000);
  }
  return summary;
}

/** Throws if any forbidden field appears at any depth. Run before any upload. */
export function assertSanitizedSummarySafe(summary) {
  const visit = (val, path) => {
    if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        if (!ALLOWED.has(k) && FORBIDDEN_KEY_PATTERNS.some((re) => re.test(k))) {
          throw new Error(`sanitized summary contains forbidden field "${k}" at ${path}`);
        }
        if (DATA_CONTAINERS.has(k)) continue; // values are numeric counts keyed by category label
        visit(v, `${path}.${k}`);
      }
    }
  };
  visit(summary, "$");
}

export function isSanitizedSummarySafe(summary) {
  try {
    assertSanitizedSummarySafe(summary);
    return true;
  } catch {
    return false;
  }
}

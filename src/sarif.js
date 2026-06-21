// SARIF 2.1.0 output for GitHub Code Scanning. Deterministic rule ids + severity mapping + file
// and line references. Contains NO source contents, secrets, or environment values — only the
// rule id, a short message, the file path, and a line number (the same safe detail the local HTML
// report shows). Generated locally; the user uploads it to THEIR OWN Code Scanning. No network.

import { SCANNER_VERSION } from "./scanner.js";

// Deterministic rule metadata. ruleId is stable per scanner rule.
const RULES = {
  "unpinned-action": { name: "Unpinned third-party action", level: "warning", help: "Pin third-party actions to a full commit SHA instead of a movable tag or branch." },
  "broad-permissions": { name: "Broad workflow token permissions", level: "warning", help: "Replace write-all with an explicit least-privilege permissions block." },
  "no-permissions-block": { name: "Missing workflow permissions block", level: "note", help: "Add an explicit top-level permissions block (contents: read by default)." },
  "prt-checkout-untrusted": { name: "pull_request_target checks out untrusted code", level: "error", help: "Avoid checking out untrusted PR head code in a privileged pull_request_target workflow." },
  "secrets-in-prt": { name: "Secrets in pull_request_target", level: "error", help: "Do not expose secrets to pull_request_target workflows that run untrusted code." },
  "script-injection": { name: "Workflow script injection", level: "error", help: "Do not interpolate untrusted ${{ ... }} input into run/script steps; pass via env and quote." },
};
const RULE_PREFIX = "taskbounty";
const DEFAULT_LEVEL = "note";

function ruleId(rule) {
  return `${RULE_PREFIX}/${String(rule || "finding").replace(/[^a-z0-9_-]/gi, "-")}`;
}

// Map our severity to a SARIF level when the rule has no explicit one.
function severityLevel(sev) {
  const s = String(sev || "").toUpperCase();
  if (s === "CRITICAL" || s === "HIGH") return "error";
  if (s === "MODERATE") return "warning";
  return "note";
}

/** Build a SARIF 2.1.0 log from a NormalizedResult. Pure; no IO, no network. */
export function renderSarif(result) {
  const evidence = Array.isArray(result?.localEvidence) ? result.localEvidence : [];

  // Collect the distinct rules actually present, in a stable order.
  const seen = new Map();
  for (const e of evidence) {
    const rid = ruleId(e.rule);
    if (!seen.has(rid)) {
      const meta = RULES[e.rule] || { name: e.category || e.rule || "Finding", level: severityLevel(e.severity), help: e.fix || "Review with a maintainer." };
      seen.set(rid, {
        id: rid,
        name: meta.name,
        shortDescription: { text: meta.name },
        fullDescription: { text: meta.help },
        defaultConfiguration: { level: meta.level || DEFAULT_LEVEL },
        helpUri: "https://www.task-bounty.com/github-actions-security-check/methodology",
        properties: { category: e.category || "other" },
      });
    }
  }
  const rules = [...seen.values()];

  const results = evidence.map((e) => {
    const meta = RULES[e.rule];
    const level = (meta && meta.level) || severityLevel(e.severity);
    const r = {
      ruleId: ruleId(e.rule),
      // Confirmed findings fail; lower-confidence ones are review suggestions.
      kind: e.confirmed ? "fail" : "review",
      level: e.confirmed ? level : "note",
      message: { text: String(e.detail || meta?.name || "Finding").slice(0, 1000) },
      properties: { confirmed: Boolean(e.confirmed), category: e.category || "other", ruleClass: e.ruleClass || "hygiene" },
    };
    if (e.file) {
      const region = e.line ? { startLine: Number(e.line) } : undefined;
      r.locations = [{
        physicalLocation: {
          artifactLocation: { uri: String(e.file) },
          ...(region ? { region } : {}),
        },
      }];
    }
    return r;
  });

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "taskbounty-check",
            informationUri: "https://www.task-bounty.com/ai-app-security-check",
            version: String(SCANNER_VERSION).replace(/^actions-audit@/, ""),
            rules,
          },
        },
        results,
      },
    ],
  };
}

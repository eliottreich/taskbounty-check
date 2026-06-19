// Deterministic GitHub Actions audit. This is a faithful, dependency-free port of the rules in
// the TaskBounty app (src/lib/security-check/scanner.ts). A parity test asserts it stays in sync.
// Pure: takes workflow file contents, returns findings. No network, no fs, no execution.

export const SCANNER_VERSION = "actions-audit@1.0.0";

const TRUSTED = /^(actions|github|docker)\//;
const SEVERITY_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

function down(sev) {
  return { CRITICAL: "HIGH", HIGH: "MODERATE", MODERATE: "LOW", LOW: "LOW" }[sev] ?? sev;
}

function unpinnedActions(lines, file, repoFullName) {
  const out = [];
  const ownLower = (repoFullName || "").toLowerCase();
  lines.forEach((line, i) => {
    const u = line.indexOf("uses:");
    const h = line.indexOf("#");
    if (u === -1 || (h !== -1 && h < u)) return;
    const m = line.match(/\buses:\s*['"]?([^@'"\s]+)@([^\s'"#]+)/);
    if (!m) return;
    const [, action, ref] = m;
    if (action.startsWith("./") || action.startsWith("docker://")) return;
    if (/^[0-9a-f]{40}$/i.test(ref)) return;
    const al = action.toLowerCase();
    const selfReferenced = al === ownLower || al.startsWith(ownLower + "/");
    const isReusableWorkflow = /\.ya?ml$/i.test(action) || /\/\.github\/workflows\//i.test(action);
    const branchLike = !/^v?\d/.test(ref);
    const thirdParty = !TRUSTED.test(action) && !selfReferenced;
    let severity = branchLike ? "HIGH" : "MODERATE";
    if (!thirdParty) severity = down(severity);
    const strong = thirdParty && !isReusableWorkflow;
    const kind = isReusableWorkflow ? "reusable workflow" : selfReferenced ? "self-referenced (first-party)" : thirdParty ? "third-party" : "first-party";
    out.push({
      rule: "unpinned-action", class: "hygiene", strong, severity, file, line: i + 1,
      detail: `${action}@${ref} is a ${kind} ${isReusableWorkflow ? "reference" : "action"} pinned to a mutable ${branchLike ? "branch" : "tag"} ref, not a commit SHA.`,
      fix: `Pin to a full-length commit SHA: uses: ${action}@<40-char-sha>  # ${ref}`,
    });
  });
  return out;
}

function permissions(text, file) {
  if (/permissions:\s*write-all/.test(text)) {
    return [{ rule: "broad-permissions", class: "hygiene", strong: true, severity: "HIGH", file, line: null,
      detail: "permissions: write-all grants the workflow token full write scope across the repo.",
      fix: "Set least-privilege permissions (e.g. top-level `permissions: read-all`) and elevate per-job only where a step needs write." }];
  }
  if (!/^\s*permissions:/m.test(text)) {
    return [{ rule: "no-permissions-block", class: "hygiene", strong: false, severity: "MODERATE", file, line: null,
      detail: "No explicit permissions: block. The workflow token may default to broad write access depending on repo settings.",
      fix: "Add a top-level `permissions: read-all` (or minimal `contents: read`) and grant writes per-job as needed." }];
  }
  return [];
}

function prTargetCheckout(text, file) {
  const out = [];
  const hasPRT = /pull_request_target/.test(text);
  if (hasPRT && /actions\/checkout/.test(text) && /ref:\s*\$\{\{\s*github\.event\.pull_request\.head|head\.ref|head\.sha/.test(text)) {
    out.push({ rule: "prt-checkout-untrusted", class: "exploit", strong: false, severity: "CRITICAL", file, line: null,
      detail: "pull_request_target checks out untrusted PR head code while repository secrets are in scope.",
      fix: "Use the pull_request trigger for untrusted code, or checkout only the base ref and never execute PR-supplied code/scripts with secrets present." });
  }
  if (hasPRT && /\$\{\{\s*secrets\./.test(text)) {
    out.push({ rule: "secrets-in-prt", class: "exploit", strong: false, severity: "HIGH", file, line: null,
      detail: "Repository secrets are referenced in a pull_request_target workflow, which fork PRs can trigger.",
      fix: "Move secret-using steps out of pull_request_target, or gate them behind a manual/approved environment." });
  }
  return out;
}

function scriptInjection(lines, file) {
  const re = /\$\{\{\s*(github\.event\.(?:issue|pull_request|comment|review|discussion)\.(?:title|body)|github\.head_ref|github\.event\.pull_request\.head\.ref)\s*\}\}/;
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(re);
    if (!m) return;
    out.push({ rule: "script-injection", class: "exploit", strong: false, severity: "HIGH", file, line: i + 1,
      detail: `Untrusted input ${m[1]} is interpolated directly. If used inside a run: step it is a shell-injection vector.`,
      fix: 'Pass untrusted values via an intermediate env: variable and reference "$VAR" (quoted) in run, never inline ${{ ... }}.' });
  });
  return out;
}

export function auditWorkflow(wf, repoFullName) {
  const lines = wf.text.split("\n");
  return [
    ...unpinnedActions(lines, wf.path, repoFullName),
    ...permissions(wf.text, wf.path),
    ...prTargetCheckout(wf.text, wf.path),
    ...scriptInjection(lines, wf.path),
  ];
}

export function auditWorkflows(files, repoFullName) {
  const findings = files.flatMap((f) => auditWorkflow(f, repoFullName));
  const hygiene = findings.filter((f) => f.class === "hygiene");
  const strongHygiene = hygiene.filter((f) => f.strong);
  const contextHygiene = hygiene.filter((f) => !f.strong);
  const exploit = findings.filter((f) => f.class === "exploit");
  let worst = "LOW";
  for (const f of [...strongHygiene, ...exploit]) {
    if (SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(worst)) worst = f.severity;
  }
  return { findings, strongHygiene, contextHygiene, exploit, worst };
}

// Local stdio MCP server for `taskbounty-check mcp`. Zero-dependency, hand-rolled JSON-RPC 2.0
// over newline-delimited stdin/stdout (the MCP stdio framing). SAFETY: runs locally only, makes
// ZERO outbound network requests, never uploads source, and never modifies files. Fix plans are
// returned as TEXT for the user/agent to apply explicitly. Diagnostics go to stderr only so they
// never corrupt the protocol stream on stdout.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanInput } from "./lib.js";
import { installNoNetworkGuard } from "./net.js";

const PROTOCOL_VERSION = "2024-11-05";

// Report the real package version so the MCP banner can never drift from package.json.
export const PKG_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
})();

// Static knowledge base — no network, no source needed.
const KB = {
  "unpinned-action": {
    title: "Third-party action pinned to a movable tag/branch",
    why: "Tags and branches can be force-moved, so a compromised upstream action could run in your pipeline with your tokens.",
    fix: ["Replace `uses: owner/action@v4` with `uses: owner/action@<full-commit-sha> # v4`.", "Resolve the SHA from the action's release/tag.", "Let Dependabot/Renovate keep the pin current."],
  },
  "broad-permissions": {
    title: "Workflow grants broad (write-all) token permissions",
    why: "A workflow with write-all can push code, open PRs, and edit issues if any step is compromised.",
    fix: ["Add a top-level `permissions:` block defaulting to `contents: read`.", "Grant only the specific scopes a job needs (e.g. `pull-requests: write`)."],
  },
  "no-permissions-block": {
    title: "Workflow has no explicit permissions block",
    why: "Without an explicit block the workflow may inherit broad default token permissions.",
    fix: ["Add `permissions:\\n  contents: read` at the top of the workflow.", "Add per-job scopes only where required."],
  },
  "prt-checkout-untrusted": {
    title: "pull_request_target checks out untrusted PR code",
    why: "pull_request_target runs with repository secrets; checking out untrusted head code can leak them.",
    fix: ["Avoid checking out PR head code in pull_request_target.", "Use pull_request, or split into a privileged job that does not run untrusted code."],
  },
  "secrets-in-prt": {
    title: "Secrets used in a pull_request_target workflow",
    why: "Untrusted contributors can craft a PR that exfiltrates secrets exposed to pull_request_target.",
    fix: ["Do not expose secrets to workflows that run untrusted PR code.", "Move secret-using steps to a trusted, gated workflow."],
  },
  "script-injection": {
    title: "Untrusted input interpolated into a run/script step",
    why: "Interpolating `${{ github.event.* }}` directly into a shell step allows command injection.",
    fix: ["Pass untrusted values via `env:` and reference `\"$VAR\"` (quoted) in the script.", "Never inline `${{ ... }}` from event data into run steps."],
  },
};

export const MCP_TOOLS = [
  {
    name: "scan_repo",
    description: "Scan a LOCAL repository for GitHub Actions + CI maintenance hygiene. Reads only workflow files on disk; makes no network requests and uploads nothing. Returns a text summary of findings by category with file/line and suggested fixes.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Local path to a repo or a directory of repos. Defaults to the current directory." } } },
  },
  {
    name: "explain_finding",
    description: "Explain what a finding means and why it matters, in plain language. Pass the rule id (e.g. unpinned-action) or a category. No network, no file access.",
    inputSchema: { type: "object", properties: { rule: { type: "string", description: "Rule id, e.g. unpinned-action, broad-permissions, no-permissions-block, script-injection." } }, required: ["rule"] },
  },
  {
    name: "generate_fix_plan",
    description: "Return a step-by-step fix plan as TEXT for a given rule (and optionally a local repo path for context). It NEVER modifies files; the user applies changes explicitly.",
    inputSchema: { type: "object", properties: { rule: { type: "string", description: "Rule id to plan a fix for." }, path: { type: "string", description: "Optional local repo path for context (read-only)." } } },
  },
];

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

/** Pure tool dispatch — returns an MCP tool result. No network, no writes. */
export function callMcpTool(name, args = {}) {
  if (name === "scan_repo") {
    const path = typeof args.path === "string" && args.path.trim() ? args.path : ".";
    const result = scanInput(path); // network already guarded off
    const cats = (result.maintenanceCandidates || []).map((c) => `- ${c.category}: ${c.count} (${c.confidence})`).join("\n") || "- none";
    const items = (result.localEvidence || []).slice(0, 50)
      .map((e) => `  • [${e.confirmed ? "confirmed" : "review"}] ${e.rule} — ${e.file}${e.line ? ":" + e.line : ""}`).join("\n") || "  • none";
    return textResult(
      `Local scan of "${path}" (no network, nothing uploaded):\n` +
      `Repos: ${result.repoCount} · workflow files: ${result.workflowFilesReviewed} · items for private review: ${result.privateReviewCount}\n\n` +
      `Maintenance candidates by category:\n${cats}\n\nFindings (local detail; confirmed vs review):\n${items}\n\n` +
      `Scope: GitHub Actions + update-automation hygiene only — not a full security audit (secrets/auth/payments/webhooks/runtime need manual review). ` +
      `Use explain_finding and generate_fix_plan for next steps.`,
    );
  }
  if (name === "explain_finding") {
    const k = KB[String(args.rule || "").trim()];
    if (!k) return textResult(`Unknown rule "${args.rule}". Known rules: ${Object.keys(KB).join(", ")}.`);
    return textResult(`${k.title}\n\nWhy it matters: ${k.why}`);
  }
  if (name === "generate_fix_plan") {
    const k = KB[String(args.rule || "").trim()];
    if (!k) return textResult(`Unknown rule "${args.rule}". Known rules: ${Object.keys(KB).join(", ")}.`);
    const steps = k.fix.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return textResult(`Fix plan for: ${k.title}\n\n${steps}\n\nThis is a plan only — review and apply the changes yourself. This tool does not modify files.`);
  }
  return { ...textResult(`Unknown tool: ${name}`), isError: true };
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

/** Run the stdio MCP server. No outbound requests by default (fetch blocked as defense in depth);
 *  stdout carries only protocol JSON. */
export function runMcp() {
  installNoNetworkGuard();
  process.stderr.write("[taskbounty-check mcp] ready on stdio (local only, no network)\n");
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handleMessage(msg);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

function handleMessage(msg) {
  const { id, method, params } = msg || {};
  if (method === "initialize") {
    return respond(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "taskbounty-check", version: PKG_VERSION } });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return; // no response for notifications
  if (method === "ping") return respond(id, {});
  if (method === "tools/list") return respond(id, { tools: MCP_TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    try {
      return respond(id, callMcpTool(name, params?.arguments || {}));
    } catch (err) {
      return respond(id, { ...textResult(`Tool error: ${err instanceof Error ? err.message : String(err)}`), isError: true });
    }
  }
  if (id !== undefined) respondError(id, -32601, `Method not found: ${method}`);
}

#!/usr/bin/env node
// taskbounty-check — scan GitHub Actions workflows for maintenance candidates LOCALLY.
// Source code and workflow contents never leave your machine. The default code path makes no
// outbound requests (fetch is additionally blocked as defense in depth). --share uploads nothing:
// it writes a sanitized local file you submit manually. Only --gh-org intentionally uses the network.

import { writeFileSync, unlinkSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { scanRepoRoots, scanInput, newScanId, toSanitizedSummary, assertSanitizedSummarySafe, renderHtml, buildNormalizedResult, SCANNER_VERSION, reviewCtaUrl, REVIEW_CTA_TEXT, renderGithubSummary, renderSarif, resolveNetworkPolicy } from "./lib.js";
import { auditWorkflows } from "./scanner.js";
import { installNoNetworkGuard } from "./net.js";
import { planInit, writeInit, WORKFLOW_RELPATH } from "./init.js";
import { runMcp } from "./mcp.js";
import { createInterface } from "node:readline";

function parseArgs(argv) {
  const flags = { share: false, dryRun: false, explainData: false, deleteReport: false, ghOrg: null, manifest: null, orgLabel: null, includeRepoNames: false, out: "actions-check-report" };
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--share") flags.share = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--explain-data") flags.explainData = true;
    else if (a === "--delete-local-report") flags.deleteReport = true;
    else if (a === "--no-network") flags.noNetwork = true;
    else if (a === "--include-repo-names") flags.includeRepoNames = true;
    else if (a === "--github-summary") flags.githubSummary = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--format") flags.format = argv[++i];
    else if (a === "--output") flags.output = argv[++i];
    else if (a === "--gh-org") flags.ghOrg = argv[++i];
    else if (a === "--manifest") flags.manifest = argv[++i];
    else if (a === "--org-label") flags.orgLabel = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--version" || a === "-v") { console.log(SCANNER_VERSION); process.exit(0); }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else if (!a.startsWith("-")) paths.push(a);
  }
  return { paths, flags };
}

function printHelp() {
  console.log(`taskbounty-check — pre-launch safety check for AI-built apps (local)

Built it with Lovable, Bolt, Replit, Cursor, or v0? This checks your GitHub Actions + CI hygiene
locally before you ship. Your source code and workflow contents never leave your machine.

Usage:
  npx taskbounty-check init                    scaffold a least-privilege GitHub workflow (previews; never overwrites)
  npx taskbounty-check mcp                      run a LOCAL stdio MCP server (scan_repo, explain_finding, generate_fix_plan)
  npx taskbounty-check [path ...]              scan a repo, or a directory of repos
  npx taskbounty-check --manifest repos.json   scan explicit local paths (JSON array)
  npx taskbounty-check --gh-org <org>          scan an org via your existing gh session (NETWORK)

Flags:
  --share                 write a sanitized counts-only file for MANUAL submission (uploads nothing; network stays off)
  --gh-org <org>          the ONLY networked mode: fetch an org's workflow files via your gh session (opt-in)
  --manifest <file>       JSON array of local repository paths
  --org-label <label>     label included in the report/summary
  --include-repo-names    include repo names in a shared summary (opt-in)
  --dry-run               scan but write/upload nothing; show what would happen
  --explain-data          print exactly what is read, written, and (optionally) transmitted, then exit
  --delete-local-report   delete the local report files after running
  --github-summary        write ONLY a sanitized counts summary to $GITHUB_STEP_SUMMARY (for CI; no files, no upload)
  --format sarif          emit SARIF 2.1.0 for GitHub Code Scanning (rule ids + file/line; no source/secrets/env)
  --output <file>         output path for --format sarif (default: taskbounty.sarif)
  --no-network            block fetch as defense in depth (default everywhere except --gh-org)
  --out <basename>        output basename (default: actions-check-report)

Scope: this checks GitHub Actions workflow + update-automation hygiene. It does NOT check exposed
secrets, auth, payments, webhooks, or runtime — those need a manual review.
Network: the default code path makes no outbound requests; fetch is additionally blocked as defense
in depth. Only --gh-org intentionally uses the network. --share uploads nothing — it writes a
sanitized local file you submit manually. Learn more: https://www.task-bounty.com/ai-app-security-check`);
}

const DATA_DOC = `Data handling for taskbounty-check

READS (allowlist — nothing else is ever opened):
  - <repo>/.github/workflows/*.yml and *.yaml
  - update-automation config: .github/dependabot.yml|yaml, renovate.json(5)/.renovaterc(.json)
  We never read source files, .env, secrets, SSH keys, credential stores, or anything outside
  the selected repository roots. Symlinks that escape a root are skipped, never followed.

WRITES (local only):
  - <out>.json  (full result incl. file/line detail — stays on your machine)
  - <out>.html  (human-readable local report)

TRANSMITS:
  - Nothing by default. The default code path makes no outbound requests; fetch is additionally
    blocked as defense in depth (this is not a complete network sandbox).
  - --share uploads NOTHING. It writes a sanitized counts-only file (scan id, label, counts by
    category, private-review COUNT, scanner version, timestamps; repo names only with
    --include-repo-names) and prints it, for you to submit MANUALLY. No source code, workflow
    contents, filenames, line numbers, secrets, tokens, paths, or evidence are included. Network
    stays off under --share.
  - Only --gh-org intentionally uses the network: your existing gh CLI session fetches the org's
    workflow files TO THIS MACHINE (read-only). Your GitHub token is never read by this tool and
    never sent to TaskBounty.`;

// --gh-org: use the user's gh session to fetch workflow files for each repo TO THIS MACHINE.
function scanGhOrg(org) {
  const list = JSON.parse(execFileSync("gh", ["repo", "list", org, "--limit", "200", "--json", "nameWithOwner", "--no-archived"], { encoding: "utf8" }));
  const repos = [];
  for (const { nameWithOwner } of list) {
    let entries = [];
    try {
      entries = JSON.parse(execFileSync("gh", ["api", `repos/${nameWithOwner}/contents/.github/workflows`], { encoding: "utf8" }));
    } catch {
      entries = [];
    }
    const workflowFiles = [];
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!/\.ya?ml$/i.test(e.name)) continue;
      try {
        const file = JSON.parse(execFileSync("gh", ["api", `repos/${nameWithOwner}/contents/${e.path}`], { encoding: "utf8" }));
        const text = Buffer.from(file.content || "", "base64").toString("utf8");
        workflowFiles.push({ path: `.github/workflows/${e.name}`, text });
      } catch { /* skip */ }
    }
    const audit = auditWorkflows(workflowFiles, nameWithOwner);
    repos.push({ repoName: nameWithOwner, audit, updater: null, workflowCount: workflowFiles.length, partial: false, failed: false });
  }
  return buildNormalizedResult({ repos, orgLabel: org, scanId: newScanId(), generatedAt: new Date().toISOString() });
}

function confirm(question) {
  // Interactive y/N. If stdin is not a TTY (e.g. CI), resolve false (caller requires --yes there).
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())); }));
}

async function runInit(dir, flags) {
  const plan = planInit(dir);
  console.log(`taskbounty-check init — proposes ${WORKFLOW_RELPATH}\n`);
  if (!plan.isRepo) console.log("Note: this directory does not look like a git repo (no .git). Proceeding anyway.\n");
  console.log("Proposed workflow (least-privilege, SHA-pinned):\n");
  console.log(plan.content);

  if (plan.exists) {
    console.log(`\n${plan.targetPath} already exists — leaving it unchanged. (init never overwrites.)`);
    return;
  }
  if (flags.dryRun) {
    console.log(`\n[dry-run] would write ${plan.targetPath}. Nothing written.`);
    return;
  }
  const ok = flags.yes || (await confirm(`\nWrite this file to ${plan.targetPath}? [y/N] `));
  if (!ok) {
    console.log(process.stdin.isTTY ? "Aborted; nothing written." : "Not a TTY; re-run with --yes to write it (or --dry-run to preview). Nothing written.");
    return;
  }
  const r = writeInit(plan);
  console.log(r === "written"
    ? `\nWrote ${plan.targetPath}. Review it and commit it yourself — this tool never commits, pushes, comments, or opens PRs.`
    : `\n${plan.targetPath} already exists — left unchanged.`);
}

async function main() {
  const { paths, flags } = parseArgs(process.argv.slice(2));

  // Subcommands (first positional token). `init` scaffolds a workflow; `mcp` runs a local
  // stdio MCP server. Neither uploads anything.
  if (paths[0] === "init") { await runInit(paths[1] || ".", flags); return; }
  if (paths[0] === "mcp") { runMcp(); return; }

  if (flags.explainData) { console.log(DATA_DOC); return; }

  // Only --gh-org intentionally uses the network. --share is a LOCAL, manual operation (it writes
  // a sanitized file to paste; it uploads nothing), so it keeps the network guard.
  const { networking, conflict } = resolveNetworkPolicy(flags);
  if (conflict) {
    console.error("Error: --no-network conflicts with --gh-org (the only networked mode).");
    process.exit(2);
  }
  if (!networking) installNoNetworkGuard(); // default + --share: no outbound requests

  // ---- gather + scan ----
  let result;
  if (flags.ghOrg) {
    console.error(`Using your local gh session to fetch workflow files for "${flags.ghOrg}" to this machine (read-only). Your token is never sent to TaskBounty.`);
    result = scanGhOrg(flags.ghOrg);
  } else {
    let roots;
    if (flags.manifest) {
      const list = JSON.parse(readFileSync(flags.manifest, "utf8"));
      roots = (Array.isArray(list) ? list : []).map((p) => resolve(p));
    } else if (paths.length > 1) {
      roots = paths.map((p) => resolve(p));
    } else {
      roots = null; // single input → discover
    }
    result = roots
      ? scanRepoRoots(roots, { orgLabel: flags.orgLabel, includeRepoNames: flags.includeRepoNames })
      : scanInput(resolve(paths[0] || "."), { orgLabel: flags.orgLabel, includeRepoNames: flags.includeRepoNames });
  }

  const summaryLine = `${result.repoCount} repos · ${result.workflowFilesReviewed} workflow files · ${result.maintenanceCandidates.reduce((n, c) => n + c.count, 0)} maintenance candidates · ${result.privateReviewCount} for private review`;

  if (flags.dryRun) {
    console.log(`[dry-run] ${summaryLine}`);
    console.log(`[dry-run] would write local report files only (${flags.out}.json and ${flags.out}.html); nothing would be uploaded.`);
    return;
  }

  // ---- SARIF mode: write SARIF 2.1.0 for GitHub Code Scanning (no html/json, no upload) ----
  // SARIF carries rule ids + a short message + file/line only — no source, secrets, or env. The
  // user uploads it to THEIR OWN Code Scanning via github/codeql-action/upload-sarif.
  if (flags.format === "sarif") {
    const sarifPath = resolve(flags.output || "taskbounty.sarif");
    writeFileSync(sarifPath, JSON.stringify(renderSarif(result), null, 2));
    console.log(summaryLine);
    console.log(`SARIF written: ${sarifPath} (no source/secrets/env; upload with github/codeql-action/upload-sarif).`);
    return;
  }

  // ---- GitHub Action mode: write ONLY a sanitized aggregate to the job summary ----
  // No local report files (nothing for the workflow to upload), no filenames/evidence, never fails
  // CI, transmits nothing. Used by the bundled Marketplace Action.
  if (flags.githubSummary) {
    const md = renderGithubSummary(result);
    const target = process.env.GITHUB_STEP_SUMMARY;
    if (target) {
      try { appendFileSync(target, md + "\n"); } catch { /* never fail CI on a summary write */ }
    } else {
      console.log(md); // local invocation without the GH env: print to stdout
    }
    console.log(summaryLine);
    return;
  }

  // ---- write local report (full detail stays local) ----
  const jsonPath = resolve(`${flags.out}.json`);
  const htmlPath = resolve(`${flags.out}.html`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  writeFileSync(htmlPath, renderHtml(result));
  console.log(summaryLine);
  console.log(`Local report written: ${htmlPath}\n               JSON: ${jsonPath}`);
  console.log(`Full detail stayed on this machine.\n${REVIEW_CTA_TEXT}\n  ${reviewCtaUrl("post_scan")}\nTaskBounty receives nothing unless you submit that form.`);

  // ---- --share: produce the sanitized summary for MANUAL paste ----
  // Automatic upload is intentionally disabled until the CLI's external security review and
  // network-traffic inspection are complete. The tool transmits nothing; you copy the payload
  // below and paste it into the organization-review form yourself.
  if (flags.share) {
    const summary = toSanitizedSummary(result, { includeRepoNames: flags.includeRepoNames });
    assertSanitizedSummarySafe(summary); // throws if anything forbidden slipped in
    const summaryPath = resolve(`${flags.out}.summary.json`);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\nSanitized summary (counts only — no source, contents, filenames, line numbers, secrets, tokens, paths, or evidence):\n`);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nSaved to ${summaryPath}. This tool transmits nothing — TaskBounty receives nothing unless you submit it yourself. To get help, paste the summary (or just a note) into the free launch-safety review:\n  ${reviewCtaUrl("share")}`);
  }

  if (flags.deleteReport) {
    for (const p of [jsonPath, htmlPath]) if (existsSync(p)) unlinkSync(p);
    console.log("Local report files deleted.");
  }
}

main().catch((e) => { console.error("Error:", e?.message || e); process.exit(1); });

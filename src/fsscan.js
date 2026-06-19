// Filesystem discovery for local scanning. SAFETY MODEL: strict allowlist, not a denylist.
// We only ever OPEN files that match the workflow allowlist inside `<root>/.github/workflows/`
// plus a fixed set of update-automation config paths. We never walk arbitrary directories and
// never open anything else (so secrets/.env/keys are never read — there is no code path to them).
// Every resolved path is confined to its root via realpath; symlinks that escape the root are
// skipped, never followed.

import { realpathSync, lstatSync, statSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join, sep, basename } from "node:path";

export const MAX_FILES_PER_REPO = 200;
export const MAX_FILE_BYTES = 512 * 1024;

const WORKFLOW_RE = /\.ya?ml$/i;
const UPDATER_PATHS = [
  ".github/dependabot.yml", ".github/dependabot.yaml",
  "renovate.json", ".github/renovate.json", "renovate.json5", ".renovaterc", ".renovaterc.json",
];

// Resolve `target` and confirm its realpath stays inside `rootReal`. Returns the realpath or null.
function withinRoot(rootReal, target) {
  try {
    const real = realpathSync(target);
    if (real === rootReal || real.startsWith(rootReal + sep)) return real;
    return null; // escapes the root (e.g. a symlink pointing outside)
  } catch {
    return null;
  }
}

function readCapped(rootReal, target) {
  // Reject symlinks that escape the root; never follow outside.
  const real = withinRoot(rootReal, target);
  if (!real) return null;
  try {
    const st = statSync(real);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

/** True if `dir` looks like a repository root (has a .github or .git entry). */
export function looksLikeRepo(dir) {
  return existsSync(join(dir, ".github")) || existsSync(join(dir, ".git"));
}

/**
 * Discover repo roots from an input path:
 *  - a single repo (has .github/.git) -> [path]
 *  - a directory of repos            -> immediate subdirs that look like repos
 */
export function discoverRepoRoots(inputPath) {
  let rootReal;
  try {
    rootReal = realpathSync(inputPath);
  } catch {
    return [];
  }
  if (looksLikeRepo(rootReal)) return [rootReal];
  // directory-of-repos: only immediate children, only those that look like repos.
  const roots = [];
  try {
    for (const name of readdirSync(rootReal)) {
      if (name.startsWith(".")) continue;
      const child = join(rootReal, name);
      const within = withinRoot(rootReal, child);
      if (!within) continue;
      try {
        if (lstatSync(child).isSymbolicLink()) continue; // do not follow symlinked subdirs
        if (statSync(within).isDirectory() && looksLikeRepo(within)) roots.push(within);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* not a readable dir */
  }
  return roots;
}

/**
 * Scan ONE repo root. Reads only `.github/workflows/*.{yml,yaml}` + updater config. Returns the
 * workflow file contents (for local scanning), updater presence, and partial/skipped info.
 */
export function scanRepoRoot(root, repoLabel = null) {
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    return { repoName: repoLabel ?? basename(root), workflowFiles: [], updater: null, partial: false, skipped: 0, error: "unreadable" };
  }
  const repoName = repoLabel ?? basename(rootReal);
  const wfDir = join(rootReal, ".github", "workflows");
  const workflowFiles = [];
  let partial = false;
  let skipped = 0;

  const wfDirReal = withinRoot(rootReal, wfDir);
  if (wfDirReal) {
    let entries = [];
    try {
      entries = readdirSync(wfDirReal);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!WORKFLOW_RE.test(name)) continue; // allowlist: only workflow yaml
      if (workflowFiles.length >= MAX_FILES_PER_REPO) { partial = true; break; }
      const text = readCapped(rootReal, join(wfDirReal, name));
      if (text == null) { skipped += 1; continue; }
      workflowFiles.push({ path: `.github/workflows/${name}`, text });
    }
  }

  // updater config (existence + ecosystem check); only these exact allowlisted paths are read.
  let updater = null;
  for (const rel of UPDATER_PATHS) {
    const text = readCapped(rootReal, join(rootReal, rel));
    if (text == null) continue;
    if (/dependabot/i.test(rel) && /package-ecosystem:\s*['"]?github-actions/.test(text)) { updater = "dependabot"; break; }
    if (/renovate|renovaterc/i.test(rel)) { updater = "renovate"; break; }
  }

  return { repoName, workflowFiles, updater, partial, skipped };
}

/**
 * Enforces the project's "no em-dashes" rule (see CONTRIBUTING.md) as a
 * ratchet, not a hard zero: the codebase carries pre-existing em-dashes the
 * rule predates, and rewriting all of them in one pass is its own separate
 * effort. This only blocks the count from growing - BASELINE is the count
 * measured when the gate was introduced, and it should be lowered (never
 * raised) as existing occurrences get cleaned up in the normal course of
 * touching a file.
 *
 * Walks the filesystem (not `git ls-files`, so an untracked local file is
 * scanned too) under the directories below - source, scripts, tests,
 * examples, docs, CI workflows and root-level project docs - for every
 * `.ts`, `.md`, `.yml`/`.yaml` and `.sh` file, excluding `node_modules` and
 * `dist`, plus the named root files below (`package.json` among them, since
 * its `description` is published to npm), and counts the U+2014 EM DASH
 * character in each.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EM_DASH = "\u2014";
const SCAN_ROOTS = ["src", "scripts", "test", "examples", "docs", ".github"];
const SCAN_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "SECURITY.md",
  // The manifest ships to npm: its `description` is the one string in this
  // repo that renders on the package page, so it is scanned even though no
  // scan root sweeps up `.json`.
  "package.json",
];
const SCAN_EXTENSIONS = [".ts", ".md", ".yml", ".yaml", ".sh"];

/**
 * Baseline em-dash count across the scanned files, measured when this gate
 * was introduced. A PR that adds em-dashes without removing at least as many
 * elsewhere pushes the total over this and fails the gate.
 */
export const BASELINE = 117;

function walk(dir: string, repoRoot: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full, repoRoot));
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(relative(repoRoot, full).split("\\").join("/"));
    }
  }
  return found;
}

/** Repo-relative paths of every file this gate scans. */
function scanPaths(repoRoot: string): string[] {
  const paths: string[] = [];
  for (const root of SCAN_ROOTS) {
    const full = join(repoRoot, root);
    try {
      if (statSync(full).isDirectory()) paths.push(...walk(full, repoRoot));
    } catch {
      // Directory doesn't exist in this checkout; nothing to scan there.
    }
  }
  for (const file of SCAN_FILES) {
    const full = join(repoRoot, file);
    try {
      if (statSync(full).isFile()) paths.push(file);
    } catch {
      // Optional file not present.
    }
  }
  return paths;
}

/** Pure: em-dash occurrences per path, for a caller that already has file contents. */
export function countEmDashes(contents: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [path, text] of Object.entries(contents)) {
    const matches = text.match(new RegExp(EM_DASH, "g"));
    if (matches) counts[path] = matches.length;
  }
  return counts;
}

function main() {
  const repoRoot = process.argv[2] ?? process.cwd();
  const paths = scanPaths(repoRoot);
  if (paths.length === 0) {
    // Never a legitimate "nothing to report": every scan root exists in
    // this repo, so an empty list means repoRoot is wrong, not that the
    // codebase is clean - passing silently here would let a broken
    // working-directory/argv change turn this gate into a no-op forever.
    throw new Error(
      `em-dash gate found no files to scan under ${repoRoot} - is this the repo root?`,
    );
  }

  const contents: Record<string, string> = {};
  for (const path of paths) {
    contents[path] = readFileSync(join(repoRoot, path), "utf-8");
  }

  const counts = countEmDashes(contents);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`em-dash occurrences: ${total} (baseline ${BASELINE})`);

  if (total > BASELINE) {
    console.log("by file:");
    for (const [path, count] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
      console.log(`  ${count}\t${path}`);
    }
    console.error(
      `::error::em-dash count ${total} exceeds the baseline of ${BASELINE} - use a plain hyphen with spaces, a comma, a colon, or restructure the sentence (see CONTRIBUTING.md)`,
    );
    process.exit(1);
  }

  if (total < BASELINE) {
    console.log(
      `em-dash count ${total} is below the baseline of ${BASELINE} - lower BASELINE in scripts/check-em-dashes.ts to lock in the improvement.`,
    );
  }
}

if (import.meta.main) {
  main();
}

/**
 * Enforces this repo's deprecate-before-remove rule at its weakest point: the
 * notice itself. A `@deprecated` tag that says a name "may be dropped in a
 * future release without notice" is not a deprecation, it is a disclaimer -
 * a host reading it cannot tell whether to migrate this week or ignore it for
 * a year, and nothing ever forces the removal to happen. So every surviving
 * `@deprecated` block in `src/` must name the literal version that removes it
 * (`Removed in 1.0.0.`), and none may hedge with without-notice language.
 *
 * Deliberately a scanner over the real tree rather than a lint rule: the check
 * is about the prose inside the tag, which no TypeScript rule reads.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** A version this deprecation is removed in, e.g. "Removed in 1.0.0." */
const REMOVAL_VERSION = /Removed in \d+\.\d+\.\d+/;

/**
 * Hedges that make a deprecation unactionable. Matched case-insensitively
 * against the whole tag block.
 */
const WITHOUT_NOTICE = /without notice|may be (dropped|removed)|at any time/i;

export interface Deprecation {
  file: string;
  /** 1-indexed line of the `@deprecated` tag. */
  line: number;
  /** The tag's own text, from `@deprecated` to the end of the comment block. */
  text: string;
}

/**
 * Every `@deprecated` tag in a file, with the rest of its comment block as
 * text. Handles both a single-line `/** @deprecated ... *\/` and a multi-line
 * block, since the repo uses both.
 */
export function findDeprecations(file: string, source: string): Deprecation[] {
  const found: Deprecation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.includes("@deprecated")) continue;
    const parts: string[] = [line];
    // A tag's text runs to the end of its comment block, so a removal version
    // on a continuation line still counts.
    if (!line.includes("*/")) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] as string;
        parts.push(next);
        if (next.includes("*/")) break;
      }
    }
    found.push({ file, line: i + 1, text: parts.join(" ") });
  }
  return found;
}

/** Human-readable problems with a set of deprecations; empty means the gate passes. */
export function checkDeprecations(deprecations: Deprecation[]): string[] {
  const problems: string[] = [];
  for (const dep of deprecations) {
    const where = `${dep.file}:${dep.line}`;
    if (!REMOVAL_VERSION.test(dep.text)) {
      problems.push(
        `${where}: @deprecated with no removal version - say "Removed in <major.minor.patch>."`,
      );
    }
    const hedge = WITHOUT_NOTICE.exec(dep.text);
    if (hedge) {
      problems.push(
        `${where}: @deprecated hedges with "${hedge[0]}" - name the removal version instead`,
      );
    }
  }
  return problems;
}

function walk(dir: string, repoRoot: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full, repoRoot));
    } else if (entry.name.endsWith(".ts")) {
      found.push(relative(repoRoot, full).split("\\").join("/"));
    }
  }
  return found;
}

/** Every deprecation in `src/`, read off the real tree. */
export function scanRepo(repoRoot: string): Deprecation[] {
  const src = join(repoRoot, "src");
  if (!statSync(src).isDirectory()) {
    throw new Error(`deprecation gate found no src/ under ${repoRoot} - is this the repo root?`);
  }
  const found: Deprecation[] = [];
  for (const path of walk(src, repoRoot)) {
    found.push(...findDeprecations(path, readFileSync(join(repoRoot, path), "utf-8")));
  }
  return found;
}

function main() {
  const repoRoot = process.argv[2] ?? process.cwd();
  const deprecations = scanRepo(repoRoot);
  const problems = checkDeprecations(deprecations);
  console.log(`@deprecated tags in src/: ${deprecations.length}`);

  if (problems.length > 0) {
    for (const problem of problems) console.log(`  ${problem}`);
    console.error(
      `::error::${problems.length} deprecation notice(s) are not actionable - see CONTRIBUTING.md's deprecate-before-remove rule`,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

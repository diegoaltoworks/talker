/**
 * Fails the build when a published bundle grows past its budget unnoticed,
 * or when a build adds a new bundle nothing here budgets for. Budgets are
 * current size plus headroom, not an aspirational target: the point is to
 * catch an unreviewed jump (a new dependency pulled into the bundle, an
 * accidental non-external import), not to force bundles to shrink.
 *
 * Run via `bun run check:bundle-budgets` after `bun run build`; the packed
 * smoke test (scripts/smoke-packed-install.sh) runs it as part of every
 * packed-install CI job, since that job already builds dist/ first.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Repo-relative dist path -> maximum bytes. Keep in sync with every entry point in build:esm/build:cjs. */
export const BUNDLE_BUDGETS: Record<string, number> = {
  "dist/index.mjs": 115_000,
  "dist/index.js": 120_000,
  "dist/adapters/twilio.mjs": 10_000,
  "dist/adapters/twilio.js": 10_000,
};

export interface BudgetResult {
  path: string;
  bytes: number;
  budget: number;
  overBudget: boolean;
}

/**
 * Pure: checks already-measured sizes against the budgets, for testing
 * without touching the filesystem. A path in `budgets` with no matching
 * entry in `sizes` reads as over budget - the build stopped emitting a
 * bundle this expects, which is exactly as loud a failure as one that grew.
 */
export function checkBudgets(
  sizes: Record<string, number>,
  budgets: Record<string, number> = BUNDLE_BUDGETS,
): BudgetResult[] {
  return Object.entries(budgets).map(([path, budget]) => {
    const bytes = sizes[path];
    if (bytes === undefined) return { path, bytes: 0, budget, overBudget: true };
    return { path, bytes, budget, overBudget: bytes > budget };
  });
}

/**
 * Pure: which emitted bundle paths have no budget entry at all. Catches the
 * gap a fixed budget list can't: a new build entry point shipping with
 * nothing measuring it.
 */
export function findUnbudgetedBundles(
  emittedPaths: string[],
  budgets: Record<string, number> = BUNDLE_BUDGETS,
): string[] {
  return emittedPaths.filter((path) => !(path in budgets));
}

function walkBundlePaths(dir: string, repoRoot: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkBundlePaths(full, repoRoot));
    } else if (/\.m?js$/.test(entry.name)) {
      found.push(relative(repoRoot, full).split("\\").join("/"));
    }
  }
  return found;
}

function main() {
  const repoRoot = process.argv[2] ?? process.cwd();
  const emittedPaths = walkBundlePaths(join(repoRoot, "dist"), repoRoot);
  const sizes: Record<string, number> = {};
  for (const path of emittedPaths) {
    sizes[path] = statSync(join(repoRoot, path)).size;
  }

  const results = checkBudgets(sizes);
  for (const result of results) {
    const status = result.overBudget ? "OVER" : "ok";
    console.log(`${status} - ${result.path}: ${result.bytes}B (budget ${result.budget}B)`);
  }

  const unbudgeted = findUnbudgetedBundles(emittedPaths);
  for (const path of unbudgeted) {
    console.log(`UNBUDGETED - ${path}: no entry in BUNDLE_BUDGETS`);
  }

  const overBudget = results.filter((result) => result.overBudget);
  if (overBudget.length > 0) {
    console.error(
      `::error::bundle budget exceeded for ${overBudget.map((r) => r.path).join(", ")} - raise the budget in scripts/bundle-budgets.ts if the growth is reviewed and intentional`,
    );
  }
  if (unbudgeted.length > 0) {
    console.error(
      `::error::no budget entry for ${unbudgeted.join(", ")} - add it to BUNDLE_BUDGETS in scripts/bundle-budgets.ts`,
    );
  }
  if (overBudget.length > 0 || unbudgeted.length > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

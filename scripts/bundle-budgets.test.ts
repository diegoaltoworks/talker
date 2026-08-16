import { describe, expect, test } from "bun:test";
import { BUNDLE_BUDGETS, checkBudgets, findUnbudgetedBundles } from "./bundle-budgets";

describe("checkBudgets", () => {
  test("a bundle under its budget is not over budget", () => {
    const results = checkBudgets({ "dist/index.mjs": 50 }, { "dist/index.mjs": 100 });
    expect(results).toEqual([
      { path: "dist/index.mjs", bytes: 50, budget: 100, overBudget: false },
    ]);
  });

  test("a bundle exactly at its budget is not over budget", () => {
    const results = checkBudgets({ "dist/index.mjs": 100 }, { "dist/index.mjs": 100 });
    expect(results[0]?.overBudget).toBe(false);
  });

  test("a bundle over its budget is flagged", () => {
    const results = checkBudgets({ "dist/index.mjs": 101 }, { "dist/index.mjs": 100 });
    expect(results[0]?.overBudget).toBe(true);
  });

  test("a budgeted bundle the build stopped emitting is a loud failure, not a silent pass", () => {
    const results = checkBudgets({}, { "dist/index.mjs": 100 });
    expect(results).toEqual([{ path: "dist/index.mjs", bytes: 0, budget: 100, overBudget: true }]);
  });

  test("checks every budgeted path independently", () => {
    const results = checkBudgets(
      { "dist/index.mjs": 50, "dist/index.js": 150 },
      { "dist/index.mjs": 100, "dist/index.js": 100 },
    );
    expect(results.find((r) => r.path === "dist/index.mjs")?.overBudget).toBe(false);
    expect(results.find((r) => r.path === "dist/index.js")?.overBudget).toBe(true);
  });
});

describe("findUnbudgetedBundles", () => {
  test("a bundle path with a budget entry is not unbudgeted", () => {
    expect(findUnbudgetedBundles(["dist/index.mjs"], { "dist/index.mjs": 100 })).toEqual([]);
  });

  test("a bundle path with no budget entry is flagged", () => {
    expect(findUnbudgetedBundles(["dist/new-entry.mjs"], { "dist/index.mjs": 100 })).toEqual([
      "dist/new-entry.mjs",
    ]);
  });

  test("checks every emitted path independently", () => {
    const result = findUnbudgetedBundles(["dist/index.mjs", "dist/new-entry.mjs"], {
      "dist/index.mjs": 100,
    });
    expect(result).toEqual(["dist/new-entry.mjs"]);
  });
});

describe("BUNDLE_BUDGETS", () => {
  test("pins the exact configured values, so a typo is caught here rather than silently loosening every check", () => {
    expect(BUNDLE_BUDGETS).toEqual({
      "dist/index.mjs": 115_000,
      "dist/index.js": 120_000,
      "dist/adapters/twilio.mjs": 10_000,
      "dist/adapters/twilio.js": 10_000,
    });
  });
});

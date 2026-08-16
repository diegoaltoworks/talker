import { describe, expect, test } from "bun:test";
import { checkDeprecations, findDeprecations, scanRepo } from "./deprecations";

describe("findDeprecations", () => {
  test("finds a single-line tag", () => {
    const found = findDeprecations(
      "a.ts",
      "/** @deprecated Removed in 1.0.0. Use x. */\nconst a=1;",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  test("reads a multi-line tag to the end of its block", () => {
    const source = [
      "/**",
      " * @deprecated Use `x`.",
      " * Removed in 1.0.0.",
      " */",
      "const a=1;",
    ].join("\n");
    const found = findDeprecations("a.ts", source);
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toContain("Removed in 1.0.0");
  });

  test("finds nothing in a file with no tags", () => {
    expect(findDeprecations("a.ts", "export const a = 1;\n")).toHaveLength(0);
  });
});

describe("checkDeprecations", () => {
  test("passes a tag that names a removal version", () => {
    const problems = checkDeprecations([
      { file: "a.ts", line: 3, text: "@deprecated Removed in 1.0.0. Use `getChannelPhrase`." },
    ]);
    expect(problems).toEqual([]);
  });

  test("rejects a tag with no removal version", () => {
    const problems = checkDeprecations([
      { file: "a.ts", line: 3, text: "@deprecated Use `getChannelPhrase` instead." },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no removal version");
  });

  test("rejects without-notice hedging even when a version is present", () => {
    const problems = checkDeprecations([
      {
        file: "a.ts",
        line: 3,
        text: "@deprecated Removed in 1.0.0, or earlier without notice.",
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("without notice");
  });

  test("rejects a may-be-dropped hedge", () => {
    const problems = checkDeprecations([
      { file: "a.ts", line: 3, text: "@deprecated The root re-export may be dropped later." },
    ]);
    // Missing version and hedging: both are reported.
    expect(problems).toHaveLength(2);
  });
});

describe("the repo's own deprecations", () => {
  const deprecations = scanRepo(`${import.meta.dir}/..`);

  test("every surviving @deprecated names a removal version and does not hedge", () => {
    expect(checkDeprecations(deprecations)).toEqual([]);
  });

  test("the unreachable 0.x deprecations are gone", () => {
    const text = deprecations.map((d) => d.text).join("\n");
    for (const name of [
      "getSanitizedBody",
      "smsRoutes",
      "whatsappRoutes",
      "saveSessionWithMessages",
      "updateSessionIncremental",
    ]) {
      expect(text).not.toContain(name);
    }
  });
});

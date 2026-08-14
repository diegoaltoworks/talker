import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `openai` is an optional peer dependency. A value import anywhere under
 * src/voice/ would make it load-bearing at module load, so importing talker at
 * all would throw for a host that did not install the SDK — a break that only
 * shows up in those hosts, never in this repo's own test run.
 *
 * The upload in transcribe.ts is built from the platform `File` global for
 * exactly this reason, rather than the SDK's `toFile` helper.
 */
describe("optional peer dependencies", () => {
  const dir = import.meta.dir;
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("imports openai for types only, everywhere under src/voice", () => {
    const valueImports = sources.filter((file) => {
      const source = readFileSync(join(dir, file), "utf8");
      return source
        .split("\n")
        .some((line) => /\bfrom\s+["']openai["']/.test(line) && !/^\s*import\s+type\b/.test(line));
    });

    expect(valueImports).toEqual([]);
  });

  it("checks a meaningful number of files, so the guard cannot pass vacuously", () => {
    expect(sources.length).toBeGreaterThan(4);
  });
});

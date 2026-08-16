import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPhrase } from "./phrases";

// Tracked-array + splice(0) rather than a single `let dir`, matching
// phrases.test.ts and flows/utils.test.ts - a `let` reassigned per-test
// throws in afterEach the moment a test is added that doesn't assign it.
const tempDirs: string[] = [];
function makeTempLangDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "talker-lang-"));
  tempDirs.push(dir);
  return dir;
}

describe("phrase rotation", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("picks variants from an array phrase and plain strings verbatim", () => {
    const dir = makeTempLangDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "en.json"),
      JSON.stringify({
        greeting: ["Variant A", "Variant B", "Variant C"],
        error: "Just one error line",
      }),
    );

    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(getPhrase("en", "greeting", dir));
    }
    expect([...seen].every((g) => g.startsWith("Variant "))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);

    expect(getPhrase("en", "error", dir)).toBe("Just one error line");
  });
});

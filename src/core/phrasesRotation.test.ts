import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPhrase } from "./phrases";

describe("phrase rotation", () => {
  it("picks variants from an array phrase and plain strings verbatim", () => {
    const dir = mkdtempSync(join(tmpdir(), "talker-lang-"));
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

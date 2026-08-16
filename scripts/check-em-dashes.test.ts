import { describe, expect, test } from "bun:test";
import { countEmDashes } from "./check-em-dashes";

// Built from a code point rather than written as a literal character, so
// this file's own source text doesn't trip the gate it's testing.
const EM_DASH = String.fromCharCode(0x2014);

describe("countEmDashes", () => {
  test("a file with no em-dash is not counted", () => {
    expect(countEmDashes({ "a.ts": "plain text, a comma, a colon" })).toEqual({});
  });

  test("counts every em-dash occurrence in a file", () => {
    expect(countEmDashes({ "a.ts": `one ${EM_DASH} two ${EM_DASH} three` })).toEqual({
      "a.ts": 2,
    });
  });

  test("checks every file independently", () => {
    const result = countEmDashes({
      "a.ts": "clean",
      "b.md": `one ${EM_DASH} dash`,
      "c.ts": EM_DASH.repeat(3),
    });
    expect(result).toEqual({ "b.md": 1, "c.ts": 3 });
  });

  test("a plain hyphen is not mistaken for an em-dash", () => {
    expect(countEmDashes({ "a.ts": "a - hyphen, not an em-dash" })).toEqual({});
  });
});

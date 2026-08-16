import { describe, expect, it } from "bun:test";
import { truncateGraphemeSafe } from "./text";

describe("truncateGraphemeSafe", () => {
  it("should return the input unchanged if under the limit", () => {
    expect(truncateGraphemeSafe("hello", 100)).toBe("hello");
  });

  it("should return the input unchanged if exactly at the limit", () => {
    const input = "a".repeat(100);
    expect(truncateGraphemeSafe(input, 100)).toBe(input);
  });

  it("should truncate input that exceeds the limit", () => {
    const input = "a".repeat(150);
    const result = truncateGraphemeSafe(input, 100);
    expect(result.length).toBe(100);
    expect(result).toBe("a".repeat(100));
  });

  it("should handle empty string", () => {
    expect(truncateGraphemeSafe("", 100)).toBe("");
  });

  it("should handle a limit of 0", () => {
    expect(truncateGraphemeSafe("hello", 0)).toBe("");
  });

  it("should handle unicode characters", () => {
    const input = "héllo wörld café";
    expect(truncateGraphemeSafe(input, 5)).toBe("héllo");
  });

  it("should truncate a very long input to the default-like limit", () => {
    const longInput = "x".repeat(5000);
    const result = truncateGraphemeSafe(longInput, 1000);
    expect(result.length).toBe(1000);
  });

  it("should not split a surrogate pair at the truncation boundary", () => {
    // "ab" + an astral emoji (a surrogate pair, length 2) + "cd" -> length 6.
    // Cutting at 3 lands inside the pair; a naive substring(0, 3) would keep
    // only the lone high surrogate.
    const input = "ab\u{1F600}cd";
    const result = truncateGraphemeSafe(input, 3);
    expect(result).toBe("ab");
    // No lone surrogate at the end of the result.
    const last = result.charCodeAt(result.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("should keep a whole astral character when it fits", () => {
    const input = "ab\u{1F600}cd";
    const result = truncateGraphemeSafe(input, 4);
    expect(result).toBe("ab\u{1F600}");
  });

  it("should not split a base character and its combining mark", () => {
    // "e" + combining acute accent (U+0301), then "f"
    const input = "e\u0301f";
    const result = truncateGraphemeSafe(input, 1);
    expect(result).toBe("");
  });
});

import { describe, expect, it } from "bun:test";
import { escapeXml } from "./xml";

describe("escapeXml", () => {
  it("should escape ampersands", () => {
    expect(escapeXml("a & b")).toBe("a &amp; b");
  });

  it("should escape angle brackets", () => {
    expect(escapeXml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("should escape double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("should escape apostrophes", () => {
    expect(escapeXml("I didn't catch that")).toBe("I didn&apos;t catch that");
  });

  it("should handle multiple special characters", () => {
    expect(escapeXml('<a href="url">link & text</a>')).toBe(
      "&lt;a href=&quot;url&quot;&gt;link &amp; text&lt;/a&gt;",
    );
  });

  it("should not double-escape the entities it emits", () => {
    expect(escapeXml("Ben & Jerry's")).toBe("Ben &amp; Jerry&apos;s");
  });

  it("should return plain text unchanged", () => {
    expect(escapeXml("Hello world")).toBe("Hello world");
  });

  it("should handle empty string", () => {
    expect(escapeXml("")).toBe("");
  });

  it("should strip XML-invalid C0 control characters", () => {
    expect(escapeXml("hello\x00\x01\x1Fworld")).toBe("helloworld");
  });

  it("should keep tab, newline, and carriage return", () => {
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("should strip control characters mixed with entities", () => {
    expect(escapeXml("a\x07 & b\x0Ec")).toBe("a &amp; bc");
  });

  it("should strip a lone high surrogate left by an upstream truncation cut", () => {
    // The high half of the astral emoji U+1F600, with its low half dropped -
    // exactly what a naive length-based truncation leaves behind.
    expect(escapeXml("ab\uD83D")).toBe("ab");
  });

  it("should strip a lone low surrogate", () => {
    expect(escapeXml("ab\uDE00cd")).toBe("abcd");
  });

  it("should keep a valid surrogate pair intact", () => {
    expect(escapeXml("ab\u{1F600}cd")).toBe("ab\u{1F600}cd");
  });
});

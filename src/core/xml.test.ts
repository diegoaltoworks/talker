import { describe, expect, it } from "bun:test";
import { escapeXml } from "./xml";

describe("escapeXml", () => {
  it("should escape ampersands", () => {
    expect(escapeXml("a & b")).toBe("a &amp; b");
  });

  it("should escape angle brackets", () => {
    expect(escapeXml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;",
    );
  });

  it("should escape double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("should handle multiple special characters", () => {
    expect(escapeXml('<a href="url">link & text</a>')).toBe(
      "&lt;a href=&quot;url&quot;&gt;link &amp; text&lt;/a&gt;",
    );
  });

  it("should return plain text unchanged", () => {
    expect(escapeXml("Hello world")).toBe("Hello world");
  });

  it("should handle empty string", () => {
    expect(escapeXml("")).toBe("");
  });
});

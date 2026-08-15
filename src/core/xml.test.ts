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
});

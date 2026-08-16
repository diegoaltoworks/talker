import { describe, expect, it } from "bun:test";
import { DEFAULT_LANGUAGE, isValidLanguageCode, normalizeLanguage } from "./language";

describe("isValidLanguageCode", () => {
  it("should accept two- and three-letter codes", () => {
    for (const code of ["en", "fr", "nl", "de", "es", "pt", "fil"]) {
      expect(isValidLanguageCode(code)).toBe(true);
    }
  });

  it("should accept a code with a region subtag", () => {
    expect(isValidLanguageCode("pt-BR")).toBe(true);
    expect(isValidLanguageCode("en-GB")).toBe(true);
  });

  it("should reject path traversal attempts", () => {
    for (const code of ["../package", "../../etc/passwd", "en/../../secret", "./en", "en.json"]) {
      expect(isValidLanguageCode(code)).toBe(false);
    }
  });

  it("should reject inherited object keys", () => {
    for (const code of ["constructor", "__proto__", "toString", "prototype"]) {
      expect(isValidLanguageCode(code)).toBe(false);
    }
  });

  it("should reject malformed casing, length and separators", () => {
    for (const code of ["EN", "e", "engl", "en_GB", "en-gb", "en-GBR", "en ", ""]) {
      expect(isValidLanguageCode(code)).toBe(false);
    }
  });

  it("should reject non-string values", () => {
    for (const value of [undefined, null, 42, {}, ["en"]]) {
      expect(isValidLanguageCode(value)).toBe(false);
    }
  });
});

describe("normalizeLanguage", () => {
  it("should pass valid codes through unchanged", () => {
    expect(normalizeLanguage("fr", "test")).toBe("fr");
    expect(normalizeLanguage("pt-BR", "test")).toBe("pt-BR");
  });

  it("should fall back to English for invalid codes", () => {
    expect(normalizeLanguage("../package", "test")).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage("constructor", "test")).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage(undefined, "test")).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage("", "test")).toBe(DEFAULT_LANGUAGE);
  });
});

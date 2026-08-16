import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LANGUAGE,
  isValidLanguageCode,
  normalizeLanguage,
  normalizeReplyLanguages,
  resolveReplyLanguage,
} from "./language";

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

describe("resolveReplyLanguage", () => {
  it("passes the detected language through unrestricted when replyLanguages is unset", () => {
    expect(resolveReplyLanguage("fr")).toEqual({ replyLanguage: "fr", mismatch: false });
  });

  it("passes the detected language through unrestricted when replyLanguages is empty", () => {
    expect(resolveReplyLanguage("fr", [])).toEqual({ replyLanguage: "fr", mismatch: false });
  });

  it("replies in kind when the detected language is in the allowlist", () => {
    expect(resolveReplyLanguage("pt", ["en", "pt"])).toEqual({
      replyLanguage: "pt",
      mismatch: false,
    });
  });

  it("narrows to the allowlist's first entry when the detected language is outside it", () => {
    expect(resolveReplyLanguage("fr", ["en", "pt"])).toEqual({
      replyLanguage: "en",
      mismatch: true,
    });
    expect(resolveReplyLanguage("nl", ["en", "pt"])).toEqual({
      replyLanguage: "en",
      mismatch: true,
    });
    expect(resolveReplyLanguage("de", ["en", "pt"])).toEqual({
      replyLanguage: "en",
      mismatch: true,
    });
    expect(resolveReplyLanguage("es", ["en", "pt"])).toEqual({
      replyLanguage: "en",
      mismatch: true,
    });
  });

  it("honours a non-English default as the allowlist's first entry", () => {
    expect(resolveReplyLanguage("fr", ["pt", "en"])).toEqual({
      replyLanguage: "pt",
      mismatch: true,
    });
  });
});

describe("normalizeReplyLanguages", () => {
  it("returns undefined for unset or empty, which is the unrestricted default", () => {
    expect(normalizeReplyLanguages(undefined)).toBeUndefined();
    expect(normalizeReplyLanguages([])).toBeUndefined();
  });

  it("passes an already-correct list through unchanged", () => {
    expect(normalizeReplyLanguages(["en", "pt"])).toEqual(["en", "pt"]);
    expect(normalizeReplyLanguages(["pt-BR"])).toEqual(["pt-BR"]);
  });

  it("lowercases the base code so an uppercase entry stops silently narrowing every reply", () => {
    expect(normalizeReplyLanguages(["EN", "PT"])).toEqual(["en", "pt"]);
  });

  it("uppercases the region subtag", () => {
    expect(normalizeReplyLanguages(["pt-br", "EN-gb"])).toEqual(["pt-BR", "en-GB"]);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeReplyLanguages([" en ", "pt "])).toEqual(["en", "pt"]);
  });

  it("drops entries that cannot be a language code, keeping the valid ones", () => {
    expect(normalizeReplyLanguages(["en", "../secret", "e", "portuguese"])).toEqual(["en"]);
  });

  it("deduplicates entries that normalize to the same code, preserving order", () => {
    expect(normalizeReplyLanguages(["EN", "en", "pt"])).toEqual(["en", "pt"]);
  });

  it("returns undefined when nothing survives, rather than a list that can never match", () => {
    expect(normalizeReplyLanguages(["portuguese", "!!"])).toBeUndefined();
  });

  it("survives a non-string entry from an untyped host config", () => {
    expect(normalizeReplyLanguages(["en", 42 as unknown as string])).toEqual(["en"]);
  });

  it("produces a list resolveReplyLanguage actually matches", () => {
    const configured = normalizeReplyLanguages(["EN", "PT"]);
    expect(resolveReplyLanguage("pt", configured)).toEqual({
      replyLanguage: "pt",
      mismatch: false,
    });
    // The same list unnormalized narrows every caller to a code nothing matches.
    expect(resolveReplyLanguage("pt", ["EN", "PT"])).toEqual({
      replyLanguage: "EN",
      mismatch: true,
    });
  });
});

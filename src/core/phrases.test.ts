import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { getFlowPhrase, getPhrase, getSmsPhrase, loadPhrases } from "./phrases";

const languageDir = join(__dirname, "../../language");

describe("Phrases", () => {
  describe("loadPhrases", () => {
    it("should load English phrases from built-in language dir", () => {
      const phrases = loadPhrases("en");
      expect(phrases.greeting).toBeDefined();
      expect(phrases.greeting.length).toBeGreaterThan(0);
    });

    it("should load French phrases", () => {
      const phrases = loadPhrases("fr");
      expect(phrases.greeting).toBeDefined();
    });

    it("should load all supported languages", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        const phrases = loadPhrases(lang);
        expect(phrases.greeting).toBeDefined();
        expect(phrases.farewell.morning).toBeDefined();
        expect(phrases.farewell.afternoon).toBeDefined();
        expect(phrases.farewell.evening).toBeDefined();
        expect(phrases.sms.greeting).toBeDefined();
        expect(phrases.flow.cancelled).toBeDefined();
      }
    });

    it("should fall back to English for unknown language", () => {
      const phrases = loadPhrases("xx");
      expect(phrases.greeting).toBe(loadPhrases("en").greeting);
    });
  });

  describe("getPhrase", () => {
    it("should return correct phrase by key", () => {
      const greeting = getPhrase("en", "greeting");
      expect(greeting).toBeDefined();
      expect(typeof greeting).toBe("string");
    });

    it("should return error phrase", () => {
      const error = getPhrase("en", "error");
      expect(error).toContain("error");
    });
  });

  describe("getSmsPhrase", () => {
    it("should return SMS-specific phrases", () => {
      const greeting = getSmsPhrase("en", "greeting");
      expect(greeting).toBeDefined();
    });

    it("should return callForHelp phrase", () => {
      const callForHelp = getSmsPhrase("en", "callForHelp");
      expect(callForHelp).toBeDefined();
    });
  });

  describe("getFlowPhrase", () => {
    it("should return flow cancelled phrase", () => {
      const cancelled = getFlowPhrase("en", "cancelled");
      expect(cancelled).toContain("cancelled");
    });
  });
});

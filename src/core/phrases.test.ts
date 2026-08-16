import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCancellationKeywords,
  getFarewellPhrase,
  getFlowPhrase,
  getPhrase,
  getPromptPhrase,
  getSmsPhrase,
  getVoicePhrase,
  getWhatsAppPhrase,
  loadPhrases,
} from "./phrases";

const _languageDir = join(__dirname, "../../language");

// Every test below makes its own scratch language dir; tracking and
// removing them here (rather than per-test) keeps each `it` block a
// one-liner and guarantees cleanup even when an assertion throws.
const tempDirs: string[] = [];
function makeTempLangDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "talker-lang-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
        expect(phrases.whatsapp.greeting).toBeDefined();
        expect(phrases.whatsapp.callForHelp).toBeDefined();
        expect(phrases.prompts.replyLanguageMismatch).toBeDefined();
      }
    });

    it("should fall back to English for unknown language", () => {
      const phrases = loadPhrases("xx");
      expect(phrases.greeting).toBe(loadPhrases("en").greeting);
    });

    it("should not read a JSON file outside the language directory", () => {
      const root = makeTempLangDir();
      const dir = join(root, "langs");
      mkdirSync(dir);
      writeFileSync(join(root, "secret.json"), JSON.stringify({ greeting: "leaked" }));

      const phrases = loadPhrases("../secret", dir);
      expect(phrases.greeting).not.toBe("leaked");
      expect(phrases.greeting).toBe(loadPhrases("en").greeting);
    });

    it("should fall back to English for inherited object keys", () => {
      for (const language of ["constructor", "__proto__", "toString"]) {
        expect(loadPhrases(language).greeting).toBe(loadPhrases("en").greeting);
      }
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

    it("should return the reply-language-mismatch instruction, written in the requested language", () => {
      expect(getPromptPhrase("en", "replyLanguageMismatch")).toContain("language");
      expect(getPromptPhrase("pt", "replyLanguageMismatch")).toContain("idioma");
      expect(getPromptPhrase("pt", "replyLanguageMismatch")).not.toBe(
        getPromptPhrase("en", "replyLanguageMismatch"),
      );
    });

    it("should not name a specific language, since a missing key falls back to this English copy on any language's prompt", () => {
      for (const language of ["en", "fr", "nl", "de", "es", "pt"]) {
        const phrase = getPromptPhrase(language, "replyLanguageMismatch").toLowerCase();
        for (const name of [
          "english",
          "francais",
          "nederlands",
          "deutsch",
          "espanol",
          "portugues",
        ]) {
          expect(phrase).not.toContain(name);
        }
      }
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

    it("should return flow error phrase", () => {
      const error = getFlowPhrase("en", "error");
      expect(typeof error).toBe("string");
      expect(error.length).toBeGreaterThan(0);
    });

    it("should return every flow phrase key for all supported languages", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        for (const key of ["cancelled", "error", "needMoreDetails"] as const) {
          const phrase = getFlowPhrase(lang, key);
          expect(typeof phrase).toBe("string");
          expect(phrase.length).toBeGreaterThan(0);
        }
      }
    });

    it("should fall back to the built-in English error copy when a language file predates the flow.error key", () => {
      const dir = makeTempLangDir();
      writeFileSync(
        join(dir, "de.json"),
        JSON.stringify({
          greeting: "Hallo",
          didNotCatch: "Wie bitte?",
          didNotHear: "Nichts gehoert.",
          didNotHearRetry: "Nochmal bitte.",
          didNotHearFinal: "Auf Wiedersehen.",
          transfer: "Verbinde.",
          acknowledgment: "Moment.",
          farewell: { morning: "Morgen", afternoon: "Nachmittag", evening: "Abend" },
          error: "Fehler.",
          timeout: "Zeitueberschreitung.",
          lostQuestion: "Frage verloren.",
          // `flow` namespace predates the `error` key - only `cancelled` shipped.
          flow: { cancelled: "Abgebrochen." },
          sms: {
            greeting: "Hallo",
            greetingShort: "Hallo",
            callForHelp: "Anrufen.",
            processingError: "Fehler.",
            genericError: "Fehler.",
          },
          whatsapp: {
            greeting: "Hallo",
            greetingShort: "Hallo",
            callForHelp: "Anrufen.",
            processingError: "Fehler.",
            genericError: "Fehler.",
          },
        }),
      );

      expect(getFlowPhrase("de", "error", dir)).toBe(getFlowPhrase("en", "error"));
      expect(getFlowPhrase("de", "cancelled", dir)).toBe("Abgebrochen.");
    });
  });

  describe("getCancellationKeywords", () => {
    it("should return a non-empty keyword list for every supported language", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        const keywords = getCancellationKeywords(lang);
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords.length).toBeGreaterThan(0);
        for (const keyword of keywords) {
          expect(typeof keyword).toBe("string");
          expect(keyword.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("should give each language its own list rather than the English one", () => {
      // Shared loanwords ("stop", "cancel") are expected; a list that is
      // wholly English means that language file never got translated.
      for (const lang of ["fr", "de", "nl", "es", "pt"]) {
        const english = new Set(getCancellationKeywords("en"));
        const translated = getCancellationKeywords(lang).filter((word) => !english.has(word));
        expect(translated.length).toBeGreaterThan(0);
      }
    });

    it("should fall back to the built-in English list for an unknown language", () => {
      expect(getCancellationKeywords("xx")).toEqual(getCancellationKeywords("en"));
    });

    it("should hand out a fresh list, not the cached phrase tree's own array", () => {
      getCancellationKeywords("en").push("banana");
      expect(getCancellationKeywords("en")).not.toContain("banana");
    });

    it("should drop blank entries and fall back to English when none survive", () => {
      const dir = makeTempLangDir();
      writeFileSync(
        join(dir, "en.json"),
        JSON.stringify({ flow: { cancellationKeywords: ["cancel", "   "] } }),
      );
      writeFileSync(join(dir, "fr.json"), JSON.stringify({ flow: { cancellationKeywords: [""] } }));

      expect(getCancellationKeywords("en", dir)).toEqual(["cancel"]);
      expect(getCancellationKeywords("fr", dir)).toEqual(getCancellationKeywords("en"));
    });

    it("should normalize a lone string into a single-entry list", () => {
      const dir = makeTempLangDir();
      writeFileSync(
        join(dir, "en.json"),
        JSON.stringify({ flow: { cancellationKeywords: "abort" } }),
      );

      expect(getCancellationKeywords("en", dir)).toEqual(["abort"]);
    });
  });

  describe("getWhatsAppPhrase", () => {
    it("should return WhatsApp-specific phrases for English", () => {
      const greeting = getWhatsAppPhrase("en", "greeting");
      expect(greeting).toBeDefined();
      expect(typeof greeting).toBe("string");
      expect(greeting.length).toBeGreaterThan(0);
    });

    it("should return WhatsApp callForHelp phrase", () => {
      const callForHelp = getWhatsAppPhrase("en", "callForHelp");
      expect(callForHelp).toBeDefined();
    });

    it("should return WhatsApp processingError phrase", () => {
      const error = getWhatsAppPhrase("en", "processingError");
      expect(error).toBeDefined();
    });

    it("should return WhatsApp genericError phrase", () => {
      const error = getWhatsAppPhrase("en", "genericError");
      expect(error).toBeDefined();
    });

    it("should return WhatsApp phrases for all supported languages", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        const greeting = getWhatsAppPhrase(lang, "greeting");
        expect(greeting).toBeDefined();
        expect(greeting.length).toBeGreaterThan(0);
      }
    });

    it("should fall back to English for unknown language", () => {
      const greeting = getWhatsAppPhrase("xx", "greeting");
      const enGreeting = getWhatsAppPhrase("en", "greeting");
      expect(greeting).toBe(enGreeting);
    });
  });

  describe("getVoicePhrase", () => {
    it("should return voice-ladder-specific phrases for English", () => {
      const unintelligible = getVoicePhrase("en", "unintelligible");
      expect(typeof unintelligible).toBe("string");
      expect(unintelligible.length).toBeGreaterThan(0);
    });

    it("should return every voice phrase key for all supported languages", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        for (const key of [
          "overCapPerNumber",
          "overCapGlobal",
          "limitUnavailable",
          "unintelligible",
          "answerFailed",
        ] as const) {
          const phrase = getVoicePhrase(lang, key);
          expect(typeof phrase).toBe("string");
          expect(phrase.length).toBeGreaterThan(0);
        }
      }
    });

    it("should fall back to English for unknown language", () => {
      const unintelligible = getVoicePhrase("xx", "unintelligible");
      const enUnintelligible = getVoicePhrase("en", "unintelligible");
      expect(unintelligible).toBe(enUnintelligible);
    });

    it("should fall back to the built-in English voice copy when a language file predates the voice namespace", () => {
      const dir = makeTempLangDir();
      writeFileSync(
        join(dir, "de.json"),
        JSON.stringify({
          greeting: "Hallo",
          didNotCatch: "Wie bitte?",
          didNotHear: "Nichts gehoert.",
          didNotHearRetry: "Nochmal bitte.",
          didNotHearFinal: "Auf Wiedersehen.",
          transfer: "Verbinde.",
          acknowledgment: "Moment.",
          farewell: { morning: "Morgen", afternoon: "Nachmittag", evening: "Abend" },
          error: "Fehler.",
          timeout: "Zeitueberschreitung.",
          lostQuestion: "Frage verloren.",
          flow: { cancelled: "Abgebrochen." },
          sms: {
            greeting: "Hallo",
            greetingShort: "Hallo",
            callForHelp: "Anrufen.",
            processingError: "Fehler.",
            genericError: "Fehler.",
          },
          whatsapp: {
            greeting: "Hallo",
            greetingShort: "Hallo",
            callForHelp: "Anrufen.",
            processingError: "Fehler.",
            genericError: "Fehler.",
          },
          // No `voice` namespace - simulates a host-supplied language file
          // written before this ladder shipped.
        }),
      );

      expect(getVoicePhrase("de", "unintelligible", dir)).toBe(
        getVoicePhrase("en", "unintelligible"),
      );
    });
  });

  describe("load-time fallback merge", () => {
    it("falls back to English for a top-level key missing from the raw file, without ever surfacing undefined", () => {
      const dir = makeTempLangDir();
      writeFileSync(join(dir, "de.json"), JSON.stringify({ error: "Fehler." }));

      const phrases = loadPhrases("de", dir);
      expect(phrases.greeting).toBe(loadPhrases("en").greeting);
      expect(getPhrase("de", "greeting", dir)).toBe(getPhrase("en", "greeting"));
      // The one key the raw file did provide is preserved, not overridden.
      expect(getPhrase("de", "error", dir)).toBe("Fehler.");
    });

    it("falls back to English when a leaf value has the wrong type", () => {
      const dir = makeTempLangDir();
      writeFileSync(join(dir, "de.json"), JSON.stringify({ greeting: 12345 }));

      expect(getPhrase("de", "greeting", dir)).toBe(getPhrase("en", "greeting"));
    });

    it("falls back to English for an empty rotation array instead of picking undefined", () => {
      const dir = makeTempLangDir();
      writeFileSync(join(dir, "de.json"), JSON.stringify({ greeting: [] }));

      expect(getPhrase("de", "greeting", dir)).toBe(getPhrase("en", "greeting"));
    });

    it("fills a missing nested namespace entirely from English without throwing", () => {
      const dir = makeTempLangDir();
      writeFileSync(join(dir, "de.json"), JSON.stringify({ greeting: "Hallo" }));

      expect(() => getSmsPhrase("de", "greeting", dir)).not.toThrow();
      expect(getSmsPhrase("de", "greeting", dir)).toBe(getSmsPhrase("en", "greeting"));
    });

    it("prefers the file's own whatsapp entry, then its sms entry, then English - in that order", () => {
      const dir = makeTempLangDir();
      writeFileSync(
        join(dir, "de.json"),
        JSON.stringify({
          sms: { greeting: "SMS auf Deutsch", greetingShort: "Kurz auf Deutsch" },
          whatsapp: { greeting: "WhatsApp auf Deutsch" },
          // whatsapp.greetingShort is missing but sms.greetingShort is
          // present - it should speak German (from sms), not English.
          // whatsapp.callForHelp is missing from both - English is the
          // only source left.
        }),
      );

      // 1. the file's own whatsapp entry wins over its own sms entry
      expect(getWhatsAppPhrase("de", "greeting", dir)).toBe("WhatsApp auf Deutsch");
      // 2. missing from whatsapp, present in sms - same language, not English
      expect(getWhatsAppPhrase("de", "greetingShort", dir)).toBe("Kurz auf Deutsch");
      // 3. missing from both whatsapp and sms - final fallback is English
      expect(getWhatsAppPhrase("de", "callForHelp", dir)).toBe(
        getWhatsAppPhrase("en", "callForHelp"),
      );
    });

    it("falls back all the way to English when the file has no sms block to borrow from either", () => {
      const dir = makeTempLangDir();
      writeFileSync(join(dir, "de.json"), JSON.stringify({ greeting: "Hallo" }));

      expect(getWhatsAppPhrase("de", "greeting", dir)).toBe(getWhatsAppPhrase("en", "greeting"));
    });
  });

  describe("getFarewellPhrase", () => {
    it("should return a farewell phrase for English", () => {
      const farewell = getFarewellPhrase("en");
      expect(farewell).toBeDefined();
      expect(typeof farewell).toBe("string");
      expect(farewell.length).toBeGreaterThan(0);
    });

    it("should return a farewell phrase for all supported languages", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        const farewell = getFarewellPhrase(lang);
        expect(farewell).toBeDefined();
        expect(farewell.length).toBeGreaterThan(0);
      }
    });

    it("should return a time-appropriate farewell", () => {
      // This test verifies the phrase is one of morning/afternoon/evening
      const phrases = loadPhrases("en");
      const farewell = getFarewellPhrase("en");
      const validFarewells = [
        phrases.farewell.morning,
        phrases.farewell.afternoon,
        phrases.farewell.evening,
      ];
      expect(validFarewells).toContain(farewell);
    });
  });
});

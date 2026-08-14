import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getFarewellPhrase,
  getFlowPhrase,
  getPhrase,
  getSmsPhrase,
  getVoicePhrase,
  getWhatsAppPhrase,
  loadPhrases,
} from "./phrases";

const _languageDir = join(__dirname, "../../language");

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

    it("should return flow error phrase", () => {
      const error = getFlowPhrase("en", "error");
      expect(typeof error).toBe("string");
      expect(error.length).toBeGreaterThan(0);
    });

    it("should return every flow phrase key for all supported languages", () => {
      for (const lang of ["en", "fr", "de", "nl", "es", "pt"]) {
        for (const key of ["cancelled", "error"] as const) {
          const phrase = getFlowPhrase(lang, key);
          expect(typeof phrase).toBe("string");
          expect(phrase.length).toBeGreaterThan(0);
        }
      }
    });

    it("should fall back to the built-in English error copy when a language file predates the flow.error key", () => {
      const dir = mkdtempSync(join(tmpdir(), "talker-lang-"));
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
      const dir = mkdtempSync(join(tmpdir(), "talker-lang-"));
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

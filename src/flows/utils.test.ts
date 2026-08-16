import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getExitMessage, shouldExitFlow } from "./utils";

/**
 * Per shipped language: a real cancellation, and messages that must NOT
 * cancel. The negatives are the adversarial ones - an inflected form of a
 * keyword, or the negated imperative that means the opposite ("don't forget
 * my room number") - because those are what a keyword list wide enough to
 * catch every phrasing gets wrong, and a wrongly-cancelled flow loses
 * everything the caller has said so far.
 */
const LANGUAGES: Array<{ code: string; cancels: string; continues: string[] }> = [
  {
    code: "en",
    cancels: "cancel that please",
    continues: ["my flight is nonstop", "quite good, thanks"],
  },
  {
    code: "fr",
    cancels: "annuler s'il vous plait",
    continues: ["je voudrais une reservation", "n'oubliez pas mon numero de chambre"],
  },
  {
    code: "es",
    cancels: "cancelar por favor",
    continues: ["quiero una reserva para dos", "puede dejarlo en la recepcion"],
  },
  {
    code: "de",
    cancels: "bitte abbrechen",
    continues: ["ich moechte eine reservierung", "wann beenden sie die arbeit"],
  },
  {
    code: "nl",
    cancels: "annuleren alsjeblieft",
    continues: ["ik wil graag een reservering", "laat maar weten wanneer het klaar is"],
  },
  {
    code: "pt",
    cancels: "cancelar por favor",
    continues: ["quero uma reserva para dois", "voce esqueceu de enviar o link"],
  },
];

describe("Flow Utils", () => {
  describe("shouldExitFlow", () => {
    it("should detect cancellation keywords", () => {
      expect(shouldExitFlow("cancel")).toBe(true);
      expect(shouldExitFlow("I want to cancel")).toBe(true);
      expect(shouldExitFlow("nevermind")).toBe(true);
      expect(shouldExitFlow("stop")).toBe(true);
      expect(shouldExitFlow("forget it")).toBe(true);
      expect(shouldExitFlow("quit")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(shouldExitFlow("CANCEL")).toBe(true);
      expect(shouldExitFlow("Nevermind")).toBe(true);
    });

    it("should not match non-cancellation messages", () => {
      expect(shouldExitFlow("hello")).toBe(false);
      expect(shouldExitFlow("what is your name")).toBe(false);
      expect(shouldExitFlow("tell me more")).toBe(false);
    });

    it("should not false-positive on words that merely contain a keyword", () => {
      expect(shouldExitFlow("quite good, thanks")).toBe(false);
      expect(shouldExitFlow("it's a nonstop flight")).toBe(false);
      expect(shouldExitFlow("my flight has a stopover")).toBe(false);
    });

    // The docstring's promise is whole-word matching, not intent detection:
    // a bare keyword standing as its own word cancels wherever it appears.
    it("should treat a keyword standing as its own word as a cancellation", () => {
      expect(shouldExitFlow("the bus stop")).toBe(true);
    });

    it("should still match a keyword at the start or end of the message", () => {
      expect(shouldExitFlow("cancel please")).toBe(true);
      expect(shouldExitFlow("please cancel")).toBe(true);
    });

    it("should match the two-word 'never mind' phrase", () => {
      expect(shouldExitFlow("never mind")).toBe(true);
    });

    it("should default to the default language when none is given", () => {
      expect(shouldExitFlow("cancel")).toBe(shouldExitFlow("cancel", "en"));
    });

    describe.each(LANGUAGES)("$code", ({ code, cancels, continues }) => {
      it("cancels on a phrase spoken in that language", () => {
        expect(shouldExitFlow(cancels, code)).toBe(true);
      });

      it("keeps the flow alive for messages that are not cancellations", () => {
        for (const message of continues) {
          expect(shouldExitFlow(message, code)).toBe(false);
        }
      });
    });

    // Phrase files are written without accents; speech-to-text output is not.
    it("should match accented speech against the unaccented keyword list", () => {
      expect(shouldExitFlow("annulé", "fr")).toBe(true);
      expect(shouldExitFlow("arrêtez", "fr")).toBe(true);
      expect(shouldExitFlow("olvídalo", "es")).toBe(true);
    });

    it("should not use another language's keywords", () => {
      // "abbrechen" is German only, so a French caller saying it is not
      // cancelling - the lists are per language, not pooled.
      expect(shouldExitFlow("abbrechen", "de")).toBe(true);
      expect(shouldExitFlow("abbrechen", "fr")).toBe(false);
    });

    it("should honor a host's own keyword list from languageDir", () => {
      const dir = mkdtempSync(join(tmpdir(), "talker-cancel-"));
      writeFileSync(
        join(dir, "en.json"),
        JSON.stringify({ flow: { cancellationKeywords: ["abort mission"] } }),
      );

      expect(shouldExitFlow("abort mission", "en", dir)).toBe(true);
      // The host's list replaces the built-in one rather than extending it.
      expect(shouldExitFlow("cancel", "en", dir)).toBe(false);
    });

    it("should fall back to the built-in list when a phrase file predates the key", () => {
      const dir = mkdtempSync(join(tmpdir(), "talker-cancel-legacy-"));
      writeFileSync(
        join(dir, "en.json"),
        JSON.stringify({ flow: { cancelled: "Done.", error: "Oops." } }),
      );

      // A caller must never be trapped in a flow by a stale phrase file.
      expect(shouldExitFlow("cancel", "en", dir)).toBe(true);
    });

    it("should accept a lone string as a single-keyword list", () => {
      const dir = mkdtempSync(join(tmpdir(), "talker-cancel-string-"));
      writeFileSync(
        join(dir, "en.json"),
        JSON.stringify({ flow: { cancellationKeywords: "abort" } }),
      );

      expect(shouldExitFlow("abort", "en", dir)).toBe(true);
    });

    // An empty keyword compiles to a pattern that matches nearly anything, so
    // the inverse of being trapped in a flow is being unable to stay in one.
    it("should ignore a blank keyword rather than cancel every message", () => {
      const dir = mkdtempSync(join(tmpdir(), "talker-cancel-blank-"));
      writeFileSync(
        join(dir, "en.json"),
        JSON.stringify({ flow: { cancellationKeywords: ["cancel", "  "] } }),
      );

      expect(shouldExitFlow("what time is it?", "en", dir)).toBe(false);
      expect(shouldExitFlow("cancel", "en", dir)).toBe(true);
    });

    it("should fall back to the built-in list when every keyword is blank", () => {
      const dir = mkdtempSync(join(tmpdir(), "talker-cancel-allblank-"));
      writeFileSync(join(dir, "en.json"), JSON.stringify({ flow: { cancellationKeywords: [""] } }));

      expect(shouldExitFlow("what time is it?", "en", dir)).toBe(false);
      expect(shouldExitFlow("cancel", "en", dir)).toBe(true);
    });

    it("should tolerate irregular spacing inside a multi-word keyword", () => {
      expect(shouldExitFlow("never  mind")).toBe(true);
      expect(shouldExitFlow("never\nmind")).toBe(true);
    });

    it("should treat an unrecognized language code as the default language", () => {
      expect(shouldExitFlow("cancel", "not-a-language")).toBe(true);
      expect(shouldExitFlow("annuler", "not-a-language")).toBe(false);
    });
  });

  describe("getExitMessage", () => {
    it("should return English exit message", () => {
      const msg = getExitMessage("en");
      expect(msg).toContain("cancelled");
    });

    it("should return message for other languages", () => {
      const frMsg = getExitMessage("fr");
      expect(frMsg).toBeDefined();
      expect(frMsg.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Orthography guard for the shipped phrase files.
 *
 * These strings are read aloud by TTS, not just displayed. A stripped accent
 * is not a cosmetic loss: "repeter" and "plait" push a French voice toward the
 * wrong vowel, "Koennten" is read as the literal letters rather than
 * "Könnten", and Spanish without the opening "¿" loses the intonation cue the
 * synthesizer uses to raise the pitch across the whole question. So each file
 * is spot-checked for the native spellings it must carry.
 *
 * English and Dutch are the two files with no expected non-ASCII beyond a
 * single Dutch numeral: English needs no diacritics at all, and Dutch uses
 * them only to disambiguate ("één", one, from "een", a). Their expectations
 * are written out rather than skipped, so a future edit that ASCII-folds a
 * file is still caught.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPhrases, type Phrases } from "./phrases";

const LANGUAGE_DIR = join(import.meta.dir, "../../language");

/** A code-point scan rather than a regex: the range a regex would need starts at a control character. */
function hasNonAscii(text: string): boolean {
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0x7f) return true;
  }
  return false;
}

/**
 * Per-file expectations: native spellings that must survive, and whether the
 * file is expected to carry any non-ASCII character at all.
 */
const FILES: Array<{
  language: string;
  expectsNonAscii: boolean;
  /** Substrings that must appear somewhere in the file. */
  spellings: string[];
}> = [
  { language: "en", expectsNonAscii: false, spellings: ["Hello!", "Goodbye"] },
  {
    language: "de",
    expectsNonAscii: true,
    spellings: ["Könnten", "gehört", "schönen", "später", "Für", "höflich"],
  },
  {
    language: "es",
    expectsNonAscii: true,
    spellings: ["¡Hola!", "¿Cómo", "entendí", "día", "Adiós", "salió"],
  },
  {
    language: "fr",
    expectsNonAscii: true,
    spellings: ["répéter", "s'il vous plaît", "Désolé", "problème", "après-midi"],
  },
  { language: "nl", expectsNonAscii: true, spellings: ["Één moment"] },
  {
    language: "pt",
    expectsNonAscii: true,
    spellings: ["Olá", "Não", "Você", "ótimo", "começar", "áudio"],
  },
];

describe("shipped phrase files keep their native orthography", () => {
  for (const { language, expectsNonAscii, spellings } of FILES) {
    describe(`${language}.json`, () => {
      const raw = readFileSync(join(LANGUAGE_DIR, `${language}.json`), "utf-8");

      test(`is ${expectsNonAscii ? "not " : ""}ASCII-only`, () => {
        expect(hasNonAscii(raw)).toBe(expectsNonAscii);
      });

      test("carries its expected native spellings", () => {
        for (const spelling of spellings) {
          expect(raw).toContain(spelling);
        }
      });

      test("survives the loader intact, not just on disk", () => {
        // The merge-with-English-fallback path rebuilds every value, so a
        // spelling that reads fine on disk can still be lost on the way out.
        const loaded = JSON.stringify(loadPhrases(language, LANGUAGE_DIR));
        for (const spelling of spellings) {
          expect(loaded).toContain(spelling);
        }
      });
    });
  }

  test("every file carries the prompts namespace, not a top-level LLM instruction", () => {
    for (const { language } of FILES) {
      const raw = JSON.parse(
        readFileSync(join(LANGUAGE_DIR, `${language}.json`), "utf-8"),
      ) as Phrases & Record<string, unknown>;
      expect(raw.prompts?.replyLanguageMismatch).toBeDefined();
      expect(raw.replyLanguageMismatch).toBeUndefined();
    }
  });
});

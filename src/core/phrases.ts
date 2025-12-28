/**
 * Multi-language phrase system
 *
 * Loads phrase files from a configurable directory.
 * Falls back to built-in English phrases if language files are not found.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Phrases } from "../types";

const phrasesCache: Record<string, Phrases> = {};

/**
 * Load phrases for a language from a directory
 */
export function loadPhrases(language: string, languageDir?: string): Phrases {
  const cacheKey = `${languageDir || "default"}:${language}`;
  if (phrasesCache[cacheKey]) {
    return phrasesCache[cacheKey];
  }

  // Try custom directory first, then built-in
  const dirs = [languageDir, join(__dirname, "../../language")].filter(Boolean) as string[];

  for (const dir of dirs) {
    const filePath = join(dir, `${language}.json`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        phrasesCache[cacheKey] = JSON.parse(content);
        return phrasesCache[cacheKey];
      } catch {
        // Continue to next directory
      }
    }
  }

  // Fallback to English if language file not found
  if (language !== "en") {
    return loadPhrases("en", languageDir);
  }

  throw new Error("English phrase file not found in any search path");
}

type SimplePhraseKey =
  | "greeting"
  | "didNotCatch"
  | "didNotHear"
  | "didNotHearRetry"
  | "didNotHearFinal"
  | "transfer"
  | "acknowledgment"
  | "error"
  | "timeout"
  | "lostQuestion";

/**
 * Get a simple phrase by key
 */
export function getPhrase(language: string, key: SimplePhraseKey, languageDir?: string): string {
  const phrases = loadPhrases(language, languageDir);
  return phrases[key];
}

/**
 * Get a time-of-day farewell phrase
 */
export function getFarewellPhrase(language: string, languageDir?: string): string {
  const phrases = loadPhrases(language, languageDir);
  const hour = new Date().getHours();

  if (hour < 12) {
    return phrases.farewell.morning;
  }
  if (hour < 18) {
    return phrases.farewell.afternoon;
  }
  return phrases.farewell.evening;
}

/**
 * Get a flow-related phrase
 */
export function getFlowPhrase(
  language: string,
  key: keyof Phrases["flow"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  return phrases.flow[key];
}

/**
 * Get an SMS-specific phrase
 */
export function getSmsPhrase(
  language: string,
  key: keyof Phrases["sms"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  return phrases.sms[key];
}

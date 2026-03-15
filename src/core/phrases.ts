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

/** Built-in English fallback — always available even when language files can't be resolved */
const ENGLISH_FALLBACK: Phrases = {
  greeting: "Hello! I'm your voice assistant. How can I help you today?",
  didNotCatch: "I didn't catch that. Could you please repeat?",
  didNotHear: "I didn't hear anything. Goodbye.",
  didNotHearRetry: "Sorry, I didn't catch that. Could you try again?",
  didNotHearFinal:
    "I'm really sorry but I cannot hear what you're saying. Please call again. Bye for now.",
  transfer: "Let me connect you with someone directly.",
  acknowledgment: "One moment please...",
  farewell: {
    morning: "You're welcome! Have a wonderful day. Goodbye!",
    afternoon: "You're welcome! Have a lovely afternoon. Goodbye!",
    evening: "You're welcome! Have a good evening. Goodbye!",
  },
  error: "Sorry, I encountered an error. Please try again later. Goodbye.",
  timeout: "Sorry, I took too long to respond. Please try again. Goodbye.",
  lostQuestion: "I'm sorry, I lost track of your question. Could you please repeat?",
  flow: {
    cancelled: "No problem! I've cancelled that. What else would you like to know?",
  },
  sms: {
    greeting: "Hi! I'm your voice assistant. Ask me anything!",
    greetingShort: "Hi! Ask me anything!",
    callForHelp: "For more complex questions, feel free to call back or reach us directly.",
    processingError: "I'm having trouble processing that. Please try texting again or call back.",
    genericError: "Sorry, something went wrong. Please try again.",
  },
  whatsapp: {
    greeting: "Hi! I'm your assistant. Send me a message and I'll help you out!",
    greetingShort: "Hi! How can I help?",
    callForHelp:
      "For more complex questions, feel free to call us directly or reply here with more details.",
    processingError: "I'm having trouble processing that. Please try sending your message again.",
    genericError: "Sorry, something went wrong. Please try again.",
  },
};

/**
 * Resolve the built-in language directory path.
 * Works both in source (src/core/) and in npm package (dist/).
 */
function resolveBuiltinLanguageDir(): string | undefined {
  // Try common locations relative to this file
  const candidates = [
    join(__dirname, "../../language"), // source: src/core/ -> language/
    join(__dirname, "../language"), // dist: dist/ -> language/
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }

  return undefined;
}

/**
 * Load phrases for a language from a directory
 */
export function loadPhrases(language: string, languageDir?: string): Phrases {
  const cacheKey = `${languageDir || "default"}:${language}`;
  if (phrasesCache[cacheKey]) {
    return phrasesCache[cacheKey];
  }

  // Try custom directory first, then built-in directory
  const builtinDir = resolveBuiltinLanguageDir();
  const dirs = [languageDir, builtinDir].filter(Boolean) as string[];

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

  // Fallback to English file if non-English language not found
  if (language !== "en") {
    return loadPhrases("en", languageDir);
  }

  // Final fallback: inlined English phrases
  phrasesCache[cacheKey] = ENGLISH_FALLBACK;
  return ENGLISH_FALLBACK;
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

/**
 * Get a WhatsApp-specific phrase.
 * Falls back to SMS phrases if whatsapp phrases are not defined.
 */
export function getWhatsAppPhrase(
  language: string,
  key: keyof Phrases["whatsapp"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  if (phrases.whatsapp) {
    return phrases.whatsapp[key];
  }
  return phrases.sms[key];
}

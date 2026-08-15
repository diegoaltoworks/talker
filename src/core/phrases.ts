/**
 * Multi-language phrase system
 *
 * Loads phrase files from a configurable directory.
 * Falls back to built-in English phrases if language files are not found.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Phrases, PhraseValue } from "../types";

/** Resolve a phrase entry: arrays rotate - a random variant per use. */
function pick(value: PhraseValue): string {
  return Array.isArray(value) ? (value[Math.floor(Math.random() * value.length)] as string) : value;
}

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
    error: "Sorry, something went wrong with that. Let's start over - what would you like to know?",
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
  voice: {
    overCapPerNumber: "You've reached today's voice reply limit. Please type your message instead.",
    overCapGlobal: "Voice replies are at capacity right now. Please type your message instead.",
    limitUnavailable:
      "I can't check voice availability right now. Please type your message instead.",
    unintelligible: "I couldn't understand that audio. Could you try again, or type your message?",
    answerFailed: "Something went wrong preparing a reply. Please try again.",
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
  return pick(phrases[key]);
}

/**
 * Get a time-of-day farewell phrase
 */
export function getFarewellPhrase(language: string, languageDir?: string): string {
  const phrases = loadPhrases(language, languageDir);
  const hour = new Date().getHours();

  if (hour < 12) {
    return pick(phrases.farewell.morning);
  }
  if (hour < 18) {
    return pick(phrases.farewell.afternoon);
  }
  return pick(phrases.farewell.evening);
}

/**
 * Get a flow-related phrase.
 * Falls back to the built-in English flow phrases for languages whose
 * phrase file predates a given `flow` key (e.g. `error` added after
 * `cancelled`).
 */
export function getFlowPhrase(
  language: string,
  key: keyof Phrases["flow"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  const value = phrases.flow?.[key];
  return value === undefined ? pick(ENGLISH_FALLBACK.flow[key]) : pick(value);
}

/**
 * Get a phrase for a messaging channel (SMS or WhatsApp). WhatsApp falls
 * back to SMS phrases if whatsapp phrases are not defined in the language
 * file.
 */
export function getChannelPhrase(
  channel: "sms" | "whatsapp",
  language: string,
  key: keyof Phrases["sms"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  if (channel === "whatsapp" && phrases.whatsapp) {
    return pick(phrases.whatsapp[key]);
  }
  return pick(phrases.sms[key]);
}

/**
 * Get an SMS-specific phrase
 */
export function getSmsPhrase(
  language: string,
  key: keyof Phrases["sms"],
  languageDir?: string,
): string {
  return getChannelPhrase("sms", language, key, languageDir);
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
  return getChannelPhrase("whatsapp", language, key, languageDir);
}

/**
 * Get a voice-reply-ladder phrase.
 * Falls back to the built-in English voice phrases for languages whose
 * phrase file predates the `voice` namespace.
 */
export function getVoicePhrase(
  language: string,
  key: keyof Phrases["voice"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  if (phrases.voice) {
    return pick(phrases.voice[key]);
  }
  return pick(ENGLISH_FALLBACK.voice[key]);
}

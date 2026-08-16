/**
 * Multi-language phrase system
 *
 * Loads phrase files from a configurable directory.
 * Falls back to built-in English phrases if language files are not found.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MessagingChannel, Phrases, PhraseValue } from "../types";
import { resolvePackagedDir } from "./assets";
import { DEFAULT_LANGUAGE, normalizeLanguage } from "./language";
import { logger } from "./logger";

/** A phrase file as read off disk, before validation - any key may be missing or malformed. */
type RawPhrases = {
  [K in keyof Phrases]?: Phrases[K] extends PhraseValue
    ? unknown
    : Partial<Record<string, unknown>>;
};

/** Resolve a phrase entry: arrays rotate - a random variant per use. */
function pick(value: PhraseValue): string {
  return Array.isArray(value) ? (value[Math.floor(Math.random() * value.length)] as string) : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPhraseValue(value: unknown): value is PhraseValue {
  if (typeof value === "string") return true;
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string")
  );
}

/**
 * Merge a raw, unvalidated phrase file over the English fallback, key by
 * key and at every depth. Any key that's missing or malformed (wrong type,
 * empty array) falls back to the built-in English copy for that key, with a
 * warning - this is the single fallback policy for the whole phrase tree, so
 * a partial or stale language file can never surface `undefined` to a caller
 * or throw when a handler reaches into a namespace it assumes is complete.
 * Walks the fallback's own keys only, so any key in the raw file that isn't
 * part of the `Phrases` shape is silently dropped - it was equally unused
 * before this merge existed, since every reader here indexes by a known key.
 */
function mergeWithFallback<T>(raw: unknown, fallback: T, language: string, path: string): T {
  if (isPlainObject(fallback)) {
    const rawObj = isPlainObject(raw) ? raw : {};
    const result = {} as Record<string, unknown>;
    for (const key of Object.keys(fallback)) {
      result[key] = mergeWithFallback(
        rawObj[key],
        (fallback as Record<string, unknown>)[key],
        language,
        path ? `${path}.${key}` : key,
      );
    }
    return result as T;
  }

  if (isPhraseValue(raw)) return raw as T;

  logger.warn("phrase key missing or invalid, falling back to built-in English", {
    language,
    key: path,
  });
  return fallback;
}

/**
 * WhatsApp phrases fall back to this language's own `sms` copy before
 * falling all the way back to English - a language file with sms text but no
 * whatsapp block still speaks that language on WhatsApp. `mergeWithFallback`
 * already resolved `merged.whatsapp` down to English for any key the raw
 * file didn't provide directly; this patches those keys back to the raw
 * file's own sms translation where one exists.
 */
function applyWhatsappSmsFallback(merged: Phrases, raw: unknown, language: string): Phrases {
  const rawWhatsapp = isPlainObject(raw) && isPlainObject(raw.whatsapp) ? raw.whatsapp : undefined;
  const rawSms = isPlainObject(raw) && isPlainObject(raw.sms) ? raw.sms : undefined;
  if (!rawSms) return merged;

  const whatsapp = { ...merged.whatsapp };
  for (const key of Object.keys(merged.whatsapp) as Array<keyof Phrases["whatsapp"]>) {
    if (isPhraseValue(rawWhatsapp?.[key])) continue; // the file's own whatsapp block already won
    const rawSmsValue = rawSms[key];
    if (isPhraseValue(rawSmsValue)) {
      whatsapp[key] = rawSmsValue;
      logger.info("whatsapp phrase missing, using this language's sms copy instead of English", {
        language,
        key: `whatsapp.${key}`,
      });
    }
  }
  return { ...merged, whatsapp };
}

const phrasesCache: Record<string, Phrases> = {};

/**
 * The built-in cancellation list, named so the blank-list fallback in
 * `getCancellationKeywords` can reach it without casting back off `Phrases`.
 * Whole words only, and no form that a caller commonly negates: "don't
 * cancel" is rare, but a list containing "forget" would end a flow on "don't
 * forget my room number". The translated lists follow the same rule.
 */
const BUILTIN_CANCELLATION_KEYWORDS = [
  "cancel",
  "nevermind",
  "never mind",
  "stop",
  "forget it",
  "quit",
];

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
  rateLimited: "Please try again in a moment.",
  chatError: "Sorry, I encountered an error processing your question.",
  flow: {
    cancelled: "No problem! I've cancelled that. What else would you like to know?",
    error: "Sorry, something went wrong with that. Let's start over - what would you like to know?",
    needMoreDetails: "Could you provide more details?",
    cancellationKeywords: BUILTIN_CANCELLATION_KEYWORDS,
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
 * Works in source (src/core/) and in both published bundles.
 */
function resolveBuiltinLanguageDir(): string | undefined {
  return resolvePackagedDir("language");
}

/**
 * Load phrases for a language from a directory.
 *
 * The code becomes a filename, so it is normalized before it is joined with
 * a directory - an unvalidated code turns this lookup into an arbitrary-JSON
 * read (`../package`). Anything malformed loads English instead.
 */
export function loadPhrases(requestedLanguage: string, languageDir?: string): Phrases {
  const language = normalizeLanguage(requestedLanguage, "loadPhrases");
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
        const raw = JSON.parse(content) as RawPhrases;
        if (!isPlainObject(raw)) {
          logger.warn("phrase file is not a JSON object, falling back to built-in English", {
            language,
            filePath,
          });
          phrasesCache[cacheKey] = ENGLISH_FALLBACK;
          return phrasesCache[cacheKey];
        }
        const merged = mergeWithFallback(raw, ENGLISH_FALLBACK, language, "");
        phrasesCache[cacheKey] = applyWhatsappSmsFallback(merged, raw, language);
        return phrasesCache[cacheKey];
      } catch {
        // Continue to next directory
      }
    }
  }

  // Fallback to English file if non-English language not found
  if (language !== DEFAULT_LANGUAGE) {
    return loadPhrases(DEFAULT_LANGUAGE, languageDir);
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
  | "lostQuestion"
  | "rateLimited"
  | "chatError";

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
 * Every `flow` key that is a phrase to speak. `cancellationKeywords` is a
 * list to match against, so picking one at random would be meaningless;
 * `getCancellationKeywords` reads it instead.
 */
type FlowPhraseKey = Exclude<keyof Phrases["flow"], "cancellationKeywords">;

/**
 * Get a flow-related phrase.
 * `loadPhrases` merges every language file over the built-in English
 * fallback at load time, so a phrase file that predates a given `flow` key
 * (e.g. `error` added after `cancelled`) already resolves to the English
 * copy for the missing key - no per-call fallback needed here.
 */
export function getFlowPhrase(language: string, key: FlowPhraseKey, languageDir?: string): string {
  const phrases = loadPhrases(language, languageDir);
  return pick(phrases.flow[key]);
}

/**
 * Get the cancellation keywords for a language.
 *
 * Returns the whole list rather than one entry: these are matched against
 * what the caller said, never spoken back. A language file may provide a
 * lone string for a single keyword; it is normalized to a one-entry list so
 * callers always get an array, and a fresh one, since the cached phrase tree
 * must not be mutable through this accessor.
 *
 * Blank entries are dropped and an all-blank list falls back to the built-in
 * English one. The load-time merge already rejects a missing or empty
 * `cancellationKeywords`, but not a `""` inside it, and an empty keyword
 * compiles to a pattern that matches nearly every message - which would end
 * every flow on its first turn.
 */
export function getCancellationKeywords(language: string, languageDir?: string): string[] {
  const value = loadPhrases(language, languageDir).flow.cancellationKeywords;
  const keywords = (Array.isArray(value) ? value : [value]).filter(
    (keyword) => keyword.trim().length > 0,
  );
  if (keywords.length > 0) return keywords;

  logger.warn("no usable cancellation keywords, falling back to built-in English", { language });
  return [...BUILTIN_CANCELLATION_KEYWORDS];
}

/**
 * Get a phrase for a messaging channel (SMS or WhatsApp).
 * `loadPhrases` resolves each `whatsapp` key in this precedence: the
 * language file's own `whatsapp` entry, then its `sms` entry (same
 * language), then the built-in English `whatsapp` copy - so this reads the
 * namespace directly.
 */
export function getChannelPhrase(
  channel: MessagingChannel,
  language: string,
  key: keyof Phrases["sms"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  return pick(phrases[channel][key]);
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
 * Falls back to this language's sms copy, then to English - see
 * `getChannelPhrase`.
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
 * `loadPhrases` fills any language file's missing `voice` keys from the
 * built-in English `voice` copy at load time, so this reads the namespace
 * directly - including for files that predate the `voice` namespace.
 */
export function getVoicePhrase(
  language: string,
  key: keyof Phrases["voice"],
  languageDir?: string,
): string {
  const phrases = loadPhrases(language, languageDir);
  return pick(phrases.voice[key]);
}

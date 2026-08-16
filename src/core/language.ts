/**
 * Language code validation
 *
 * The active language is derived by an LLM from what the caller says, so it
 * is caller-influenced data and must never reach a filesystem path or an
 * object index unchecked. Every entry point that accepts a language code
 * (context storage, phrase loading, voice lookup) narrows it through
 * `isValidLanguageCode` first.
 */

import { logger } from "./logger";

/** The language used whenever a code is missing or fails validation. */
export const DEFAULT_LANGUAGE = "en";

/**
 * ISO 639 code with an optional ISO 3166 region: `en`, `pt`, `fil`, `pt-BR`.
 * Deliberately narrow - it admits no separator, no dot and no character that
 * could traverse a path or name a prototype key.
 */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** True for a well-formed language code, false for anything else. */
export function isValidLanguageCode(language: unknown): language is string {
  return typeof language === "string" && LANGUAGE_CODE.test(language);
}

/**
 * Return the code when it is well-formed, otherwise `en` with a warning.
 * `where` names the caller so a rejected code is traceable in the logs.
 */
export function normalizeLanguage(language: unknown, where: string): string {
  if (isValidLanguageCode(language)) return language;
  if (language !== undefined && language !== null && language !== "") {
    logger.warn("invalid language code, using default", { where, language: String(language) });
  }
  return DEFAULT_LANGUAGE;
}

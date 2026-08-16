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

/** Which language to reply in, and whether that differs from what was detected. */
export interface ReplyLanguageResolution {
  replyLanguage: string;
  mismatch: boolean;
}

/**
 * Narrow a detected language down to one `processOutgoing` is willing to
 * reply in, per `TalkerConfig.replyLanguages`.
 *
 * Detection stays unrestricted regardless of this config - a caller in any
 * language is still understood - this only picks the reply language.
 * `replyLanguages` unset or empty: unrestricted, the detected language
 * passes through untouched and `mismatch` is always false, so unconfigured
 * behavior is unchanged. Set: an exact match replies in kind; anything else
 * falls back to the list's first (default) entry with `mismatch: true`, so
 * the caller hosting the reply can prepend a short acknowledgment.
 *
 * Matching is exact, so `replyLanguages` entries must be the lowercase
 * codes detection actually emits (`en`, `pt-BR`, ...), the same shape
 * `isValidLanguageCode` accepts - `'EN'` or a casing mismatch never matches
 * and silently narrows every reply.
 */
export function resolveReplyLanguage(
  detectedLanguage: string,
  replyLanguages?: string[],
): ReplyLanguageResolution {
  if (!replyLanguages || replyLanguages.length === 0) {
    return { replyLanguage: detectedLanguage, mismatch: false };
  }
  if (replyLanguages.includes(detectedLanguage)) {
    return { replyLanguage: detectedLanguage, mismatch: false };
  }
  return { replyLanguage: replyLanguages[0] as string, mismatch: true };
}

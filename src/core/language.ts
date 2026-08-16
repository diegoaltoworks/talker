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
 * Matching is exact, so `replyLanguages` entries must be the codes detection
 * actually emits (`en`, `pt-BR`, ...), the same shape `isValidLanguageCode`
 * accepts. `normalizeReplyLanguages` puts a configured list into that shape
 * once, at mount time, so `'EN'` cannot reach here and silently narrow every
 * reply to a language that never matches.
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

/**
 * Put a configured `TalkerConfig.replyLanguages` into the shape
 * `resolveReplyLanguage` matches against, once, at mount time.
 *
 * Matching there is exact, so an entry that is merely mis-cased (`'EN'`,
 * `'pt-br'`) matches nothing: every caller falls through to the list's first
 * entry with `mismatch: true`, and the operator sees every reply narrowed and
 * apologetic with no error anywhere to explain it. Casing is normalized here
 * rather than at match time so the fix is visible in one place and costs
 * nothing per request.
 *
 * An entry that cannot be a language code at all is dropped with a warning
 * rather than silently kept: keeping it would leave a value in the list that
 * can never match, and throwing would take down a mount over a typo in an
 * optional narrowing. A list with nothing valid left returns `undefined`,
 * which is the unrestricted default - the safer of the two readings, since
 * the alternative is replying to everyone in a code that resolves to nothing.
 */
export function normalizeReplyLanguages(replyLanguages?: string[]): string[] | undefined {
  if (!replyLanguages || replyLanguages.length === 0) return undefined;

  const normalized: string[] = [];
  for (const entry of replyLanguages) {
    if (typeof entry !== "string") {
      logger.warn("invalid replyLanguages entry, ignoring", {
        where: "normalizeReplyLanguages",
        entry: String(entry),
      });
      continue;
    }
    const [base, region] = entry.trim().split("-");
    const candidate = region
      ? `${(base ?? "").toLowerCase()}-${region.toUpperCase()}`
      : (base ?? "").toLowerCase();
    if (!isValidLanguageCode(candidate)) {
      logger.warn("invalid replyLanguages entry, ignoring", {
        where: "normalizeReplyLanguages",
        entry,
      });
      continue;
    }
    if (!normalized.includes(candidate)) normalized.push(candidate);
  }

  if (normalized.length === 0) {
    logger.warn("replyLanguages had no valid entries, replies stay unrestricted", {
      where: "normalizeReplyLanguages",
    });
    return undefined;
  }
  return normalized;
}

/**
 * Flow utility functions
 *
 * `shouldExitFlow` mirrors `@diegoaltoworks/chatter/flows`' word-bounded
 * cancellation check rather than importing it: chatter is an optional peer,
 * and this check runs synchronously on every in-flow message, before any
 * peer-loading path (see ./engine.ts and src/peer-deps.test.ts). The keywords
 * themselves come from the phrase files, so a caller can leave a flow in the
 * language they are speaking, and a host can extend the list without forking.
 */

import { DEFAULT_LANGUAGE, normalizeLanguage } from "../core/language";
import { getCancellationKeywords, getFlowPhrase } from "../core/phrases";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whole-word pattern for one keyword. Words are joined with `\s+` rather
 * than a literal space so "never mind" still matches transcription that ran
 * the words together across a line break or doubled the spacing.
 */
function keywordPattern(keyword: string): RegExp {
  const words = fold(keyword).trim().split(/\s+/).map(escapeRegExp);
  return new RegExp(`(^|\\W)${words.join("\\s+")}($|\\W)`, "i");
}

/**
 * Drop diacritics so ASCII phrase-file keywords match accented speech-to-text
 * output ("annule" matches "annulé", "olvidalo" matches "olvídalo"). The
 * phrase files are written without accents; callers are not.
 */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// This check runs on every in-flow message, so the patterns for a language
// are compiled once and reused. Keyed by directory too: a host's languageDir
// overrides the built-in keywords for the same language code. The code is
// normalized first, so an unrecognized one shares the default language's
// entry instead of growing the cache once per bad code.
const patternCache = new Map<string, RegExp[]>();

function cancellationPatterns(requestedLanguage: string, languageDir?: string): RegExp[] {
  const language = normalizeLanguage(requestedLanguage, "shouldExitFlow");
  const cacheKey = `${languageDir || "default"}:${language}`;
  const cached = patternCache.get(cacheKey);
  if (cached) return cached;

  const patterns = getCancellationKeywords(language, languageDir).map(keywordPattern);
  patternCache.set(cacheKey, patterns);
  return patterns;
}

/**
 * Check if the user wants to exit the current flow, in the language they are
 * speaking. Falls back to the default language's keywords when none is known.
 *
 * Matching is whole-word: "quite good" and "nonstop" do not trigger on
 * "quit"/"stop". A keyword standing as its own word anywhere in the message
 * does trigger, including inside a longer phrase - "bus stop" ends the flow.
 * That is the deliberate trade: a mid-flow caller saying a bare cancellation
 * word means it, and stranding them in a flow is the worse failure.
 */
export function shouldExitFlow(
  message: string,
  language: string = DEFAULT_LANGUAGE,
  languageDir?: string,
): boolean {
  const folded = fold(message);
  return cancellationPatterns(language, languageDir).some((pattern) => pattern.test(folded));
}

/**
 * Get exit message for a specific language
 */
export function getExitMessage(language: string, languageDir?: string): string {
  return getFlowPhrase(language, "cancelled", languageDir);
}

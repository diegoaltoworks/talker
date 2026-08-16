/**
 * Flow utility functions
 *
 * `shouldExitFlow` mirrors `@diegoaltoworks/chatter/flows`' word-bounded
 * cancellation check rather than importing it: chatter is an optional peer,
 * and this check runs synchronously on every in-flow message, before any
 * peer-loading path (see ./engine.ts and src/peer-deps.test.ts).
 */

import { getFlowPhrase } from "../core/phrases";

const CANCELLATION_KEYWORDS = ["cancel", "nevermind", "never mind", "stop", "forget it", "quit"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompiled once at module load - this check runs on every in-flow message.
const CANCELLATION_PATTERNS = CANCELLATION_KEYWORDS.map(
  (keyword) => new RegExp(`(^|\\W)${escapeRegExp(keyword)}($|\\W)`, "i"),
);

/**
 * Check if user wants to exit the current flow.
 * Matches whole cancellation phrases only, so "quite good" or "bus stop"
 * do not falsely trigger on "quit"/"stop" as substrings.
 */
export function shouldExitFlow(message: string): boolean {
  return CANCELLATION_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Get exit message for a specific language
 */
export function getExitMessage(language: string, languageDir?: string): string {
  return getFlowPhrase(language, "cancelled", languageDir);
}

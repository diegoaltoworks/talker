/**
 * Flow utility functions
 */

import { getFlowPhrase } from "../core/phrases";

const CANCELLATION_KEYWORDS = ["cancel", "nevermind", "stop", "forget it", "quit"];

/**
 * Check if user wants to exit the current flow
 */
export function shouldExitFlow(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return CANCELLATION_KEYWORDS.some((keyword) => lowerMessage.includes(keyword));
}

/**
 * Get exit message for a specific language
 */
export function getExitMessage(language: string, languageDir?: string): string {
  return getFlowPhrase(language, "cancelled", languageDir);
}

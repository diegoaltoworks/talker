/**
 * Conversation Context Store
 *
 * In-memory Map-based context management for telephony sessions.
 * Stores per-phone-number state: language, message history, active flow, retry counts.
 */

import type { Channel, FlowState, TelephonyContext } from "../types";
import { logger } from "./logger";

const contexts = new Map<string, TelephonyContext>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup of stale contexts
 */
export function startCleanup(ttlMs: number, intervalMs: number): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [phoneNumber, context] of contexts) {
      if (now - context.lastActivity > ttlMs) {
        contexts.delete(phoneNumber);
        logger.info(`context expired for ${phoneNumber}`);
      }
    }
  }, intervalMs);
}

/**
 * Stop periodic cleanup (for testing / shutdown)
 */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Get or create a context for a phone number
 */
export function getOrCreateContext(
  phoneNumber: string,
  channel: Channel = "call",
): TelephonyContext {
  let context = contexts.get(phoneNumber);

  if (!context) {
    context = {
      phoneNumber,
      channel,
      detectedLanguage: null,
      messageHistory: [],
      activeFlow: null,
      noSpeechRetries: 0,
      lastPrompt: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    contexts.set(phoneNumber, context);
    logger.info(`context created for ${phoneNumber} (${channel})`);
  }

  context.lastActivity = Date.now();
  return context;
}

/**
 * Get context without creating one
 */
export function getContext(phoneNumber: string): TelephonyContext | undefined {
  return contexts.get(phoneNumber);
}

/**
 * Set detected language (first detection wins)
 */
export function setDetectedLanguage(phoneNumber: string, language: string): void {
  const context = getOrCreateContext(phoneNumber);
  if (!context.detectedLanguage) {
    context.detectedLanguage = language;
    logger.info(`detected language for ${phoneNumber}: ${language}`);
  }
}

/**
 * Get detected language for a phone number
 */
export function getDetectedLanguage(phoneNumber: string): string | null {
  return contexts.get(phoneNumber)?.detectedLanguage || null;
}

/**
 * Add a message to conversation history
 */
export function addMessage(
  phoneNumber: string,
  role: "user" | "assistant",
  content: string,
  channel: Channel = "call",
): void {
  const context = getOrCreateContext(phoneNumber, channel);
  context.messageHistory.push({ role, content, timestamp: Date.now() });
  // Keep last 10 messages to avoid context bloat
  if (context.messageHistory.length > 10) {
    context.messageHistory = context.messageHistory.slice(-10);
  }
}

/**
 * Get message history for a phone number
 */
export function getMessageHistory(
  phoneNumber: string,
): Array<{ role: "user" | "assistant"; content: string; timestamp: number }> {
  return contexts.get(phoneNumber)?.messageHistory || [];
}

/**
 * Clear all context for a phone number
 */
export function clearContext(phoneNumber: string): void {
  contexts.delete(phoneNumber);
  logger.info("context cleared", { phoneNumber });
}

// Flow state management

export function setActiveFlow(
  phoneNumber: string,
  flowName: string,
  params: Record<string, unknown> = {},
): void {
  const context = contexts.get(phoneNumber);
  if (!context) return;

  context.activeFlow = {
    flowName,
    params,
    attempts: 0,
    startedAt: Date.now(),
  };
  logger.info(`flow activated for ${phoneNumber}: ${flowName}`);
}

export function getActiveFlow(phoneNumber: string): FlowState | null {
  return contexts.get(phoneNumber)?.activeFlow || null;
}

export function updateFlowParams(phoneNumber: string, params: Record<string, unknown>): void {
  const context = contexts.get(phoneNumber);
  if (!context || !context.activeFlow) return;

  context.activeFlow.params = { ...context.activeFlow.params, ...params };
  context.activeFlow.attempts += 1;
}

export function clearActiveFlow(phoneNumber: string): void {
  const context = contexts.get(phoneNumber);
  if (!context) return;

  logger.info(`flow cleared for ${phoneNumber}: ${context.activeFlow?.flowName}`);
  context.activeFlow = null;
}

// No-speech retry management

export function incrementNoSpeechRetries(phoneNumber: string): number {
  const context = contexts.get(phoneNumber);
  if (!context) return 0;

  context.noSpeechRetries += 1;
  return context.noSpeechRetries;
}

export function getNoSpeechRetries(phoneNumber: string): number {
  return contexts.get(phoneNumber)?.noSpeechRetries || 0;
}

export function resetNoSpeechRetries(phoneNumber: string): void {
  const context = contexts.get(phoneNumber);
  if (context && context.noSpeechRetries > 0) {
    context.noSpeechRetries = 0;
  }
}

export function setLastPrompt(phoneNumber: string, prompt: string): void {
  const context = getOrCreateContext(phoneNumber);
  context.lastPrompt = prompt;
}

export function getLastPrompt(phoneNumber: string): string | null {
  return contexts.get(phoneNumber)?.lastPrompt || null;
}

/**
 * Clear all contexts (for testing)
 */
export function clearAllContexts(): void {
  contexts.clear();
}

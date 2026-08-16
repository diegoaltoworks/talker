/**
 * Conversation Context Store
 *
 * In-memory Map-based context management for telephony sessions.
 * Stores per-phone-number state: language, message history, active flow, retry counts.
 */

import type { Channel, FlowState, TelephonyContext } from "../types";
import { getErrorMessage } from "./errors";
import { DEFAULT_LANGUAGE, isValidLanguageCode } from "./language";
import { logger } from "./logger";

const contexts = new Map<string, TelephonyContext>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let cleanupConfig: { ttlMs: number; intervalMs: number } | null = null;

/**
 * Start periodic cleanup of stale contexts. `onTick`, when given, runs on
 * every tick alongside context expiry - a way for other in-memory stores
 * (e.g. call/pending's PendingQuery map) to reuse this single timer instead
 * of running their own.
 *
 * The timer is a module-level singleton: a second call while one is already
 * running is a no-op and its `ttlMs`/`intervalMs` are silently ignored (only
 * `onTick` would matter here anyway, since both mounts share the same
 * `contexts` map). Mounting `createTelephonyRoutes`/`createStandaloneServer`
 * more than once in a process - two chatter instances, a test that doesn't
 * call `stopCleanup()` between setups - inherits the first mount's config;
 * this logs so that isn't silent. Call `stopCleanup()` first if a later
 * mount's config should actually take effect.
 *
 * Unref'd so a lone pending interval never keeps a standalone/CLI process
 * alive after everything else has finished - callers that do need to wait on
 * it (tests measuring ticks) already await other signals, not process exit.
 */
export function startCleanup(ttlMs: number, intervalMs: number, onTick?: () => void): void {
  if (cleanupTimer) {
    const configChanged =
      cleanupConfig && (cleanupConfig.ttlMs !== ttlMs || cleanupConfig.intervalMs !== intervalMs);
    // A second call's onTick is always dropped silently, even when
    // ttlMs/intervalMs match - it's a distinct closure every time (e.g. a
    // second mount's own sweepPending(pendingQueryTtlMs) config), so there's
    // no meaningful way to compare it against the one already wired up.
    if (configChanged || onTick) {
      logger.warn(
        "startCleanup called again while a cleanup timer is already running - ignoring, first mount wins",
        { active: cleanupConfig, ignored: { ttlMs, intervalMs, hasOnTick: !!onTick } },
      );
    }
    return;
  }
  cleanupConfig = { ttlMs, intervalMs };
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [phoneNumber, context] of contexts) {
      if (now - context.lastActivity > ttlMs) {
        contexts.delete(phoneNumber);
        logger.info("context expired", { phoneNumber });
      }
    }
    try {
      onTick?.();
    } catch (error) {
      logger.error("cleanup onTick failed", { error: getErrorMessage(error) });
    }
  }, intervalMs);
  cleanupTimer.unref?.();
}

/**
 * Stop periodic cleanup (for testing / shutdown)
 */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    cleanupConfig = null;
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
    logger.info("context created", { phoneNumber, channel });
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
 * Set detected language (first detection wins).
 *
 * The language is LLM-derived from caller speech and sticks for the life of
 * the context, so a malformed code is rejected here rather than stored: it
 * would otherwise be reused as a path segment and an object key on every
 * turn until the context expires. Rejecting without storing keeps the slot
 * open for the next, well-formed detection.
 */
export function setDetectedLanguage(phoneNumber: string, language: string): void {
  if (!isValidLanguageCode(language)) {
    logger.warn("ignoring invalid detected language", { phoneNumber, language: String(language) });
    return;
  }
  const context = getOrCreateContext(phoneNumber);
  if (!context.detectedLanguage) {
    context.detectedLanguage = language;
    logger.info("detected language", { phoneNumber, language });
  }
}

/**
 * Get detected language for a phone number
 */
export function getDetectedLanguage(phoneNumber: string): string | null {
  return contexts.get(phoneNumber)?.detectedLanguage || null;
}

/**
 * The language to render this caller's next phrase in.
 *
 * Detection runs on the caller's first utterance and sticks for the life of
 * the context, so every phrase lookup after that turn has a language to use.
 * This is the one accessor phrase call sites reach for: writing
 * `getDetectedLanguage(x) || "en"` at each site works until one site forgets,
 * and a single forgotten site is a caller who said one thing in French and
 * hears the next error, timeout or acknowledgment in English.
 *
 * Falls back to `DEFAULT_LANGUAGE` before detection has run (or for a number
 * with no context at all), which is what the phrase loader would resolve to
 * anyway - so the fallback is stated here rather than left implicit.
 */
export function resolveLanguage(phoneNumber: string): string {
  return getDetectedLanguage(phoneNumber) || DEFAULT_LANGUAGE;
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
  logger.info("flow activated", { phoneNumber, flowName });
}

export function getActiveFlow(phoneNumber: string): FlowState | null {
  return contexts.get(phoneNumber)?.activeFlow || null;
}

export function updateFlowParams(phoneNumber: string, params: Record<string, unknown>): void {
  const context = contexts.get(phoneNumber);
  if (!context?.activeFlow) return;

  context.activeFlow.params = { ...context.activeFlow.params, ...params };
  context.activeFlow.attempts += 1;
}

export function clearActiveFlow(phoneNumber: string): void {
  const context = contexts.get(phoneNumber);
  if (!context) return;

  logger.info("flow cleared", { phoneNumber, flowName: context.activeFlow?.flowName });
  context.activeFlow = null;
}

// No-speech retry management

/**
 * @deprecated Internal call-flow bookkeeping (see `src/routes/call/handle-nospeech.ts`);
 * internal callers within this package are unaffected. Not part of the
 * documented public API — unlike its read-only sibling `getNoSpeechRetries`,
 * which was never exported from the package root at all — and the package
 * root re-export may be dropped in a future release without notice.
 */
export function incrementNoSpeechRetries(phoneNumber: string): number {
  const context = contexts.get(phoneNumber);
  if (!context) return 0;

  context.noSpeechRetries += 1;
  return context.noSpeechRetries;
}

export function getNoSpeechRetries(phoneNumber: string): number {
  return contexts.get(phoneNumber)?.noSpeechRetries || 0;
}

/**
 * @deprecated Internal call-flow bookkeeping (see `src/routes/call/handle-respond.ts`);
 * internal callers within this package are unaffected. Not part of the
 * documented public API, and the package root re-export may be dropped in a
 * future release without notice.
 */
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
 *
 * @deprecated Test-only reset helper; existing test usage is unaffected. Not
 * part of the documented public API, and the package root re-export may be
 * dropped in a future release without notice.
 */
export function clearAllContexts(): void {
  contexts.clear();
}

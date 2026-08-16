/**
 * Conversation Context Store
 *
 * Per-phone-number telephony session state: language, message history,
 * active flow, retry counts. Held behind an injected, synchronous
 * `ContextStore` (the structural-interface shape of `VoiceLimitsStore` - see
 * `src/voice/limits.ts` - though not its async contract; see the interface
 * doc below) so a host can swap the built-in `Map` for another in-process
 * implementation: an LRU with its own eviction policy, a store instrumented
 * for metrics/observability, or a test double. `createInMemoryContextStore()`
 * is this module's own default; `TalkerConfig.contextStore` only overrides
 * it when a host sets one (see `configureContextStore` and `src/mount.ts`).
 */

import type { Channel, FlowState, TelephonyContext } from "../types";
import { getErrorMessage } from "./errors";
import { DEFAULT_LANGUAGE, isValidLanguageCode } from "./language";
import { logger } from "./logger";

/**
 * Structural dependency for per-phone-number context storage - any object
 * with these methods satisfies it, the same shape as `VoiceLimitsStore`.
 *
 * Synchronous, unlike `VoiceLimitsStore`: every mutation in this module
 * (bumping `lastActivity`, pushing to `messageHistory`, and so on) writes
 * the updated `TelephonyContext` back through `set()` before returning, so
 * an implementation is free to clone/serialize on both `get()` and `set()` -
 * nothing outside this module holds onto a `TelephonyContext` across two
 * calls and mutates it directly. That rules out only a store whose
 * read/write genuinely cannot complete synchronously (a networked cache, a
 * remote database) - those would need an async interface, which is a larger
 * redesign this one does not attempt.
 */
export interface ContextStore {
  get(phoneNumber: string): TelephonyContext | undefined;
  set(phoneNumber: string, context: TelephonyContext): void;
  delete(phoneNumber: string): void;
  clear(): void;
  /** A snapshot or live view of all entries, for the cleanup sweep. Order is not significant. */
  entries(): Iterable<readonly [string, TelephonyContext]>;
}

/** The default `ContextStore`: a plain in-memory `Map`, single-process only. */
export function createInMemoryContextStore(): ContextStore {
  const contexts = new Map<string, TelephonyContext>();
  return {
    get: (phoneNumber) => contexts.get(phoneNumber),
    set: (phoneNumber, context) => {
      contexts.set(phoneNumber, context);
    },
    delete: (phoneNumber) => {
      contexts.delete(phoneNumber);
    },
    clear: () => {
      contexts.clear();
    },
    entries: () => contexts.entries(),
  };
}

let contexts: ContextStore = createInMemoryContextStore();

/**
 * Swap the active `ContextStore`. Called by `src/mount.ts` (shared by
 * `createTelephonyRoutes`/`createStandaloneServer`) only when
 * `config.contextStore` is explicitly set - leaving it unset keeps this
 * module's own default, shared across mounts in the same process. Any call
 * replaces the store outright: entries already in the previous store become
 * unreachable, so call it before serving traffic, not mid-flight.
 */
export function configureContextStore(newStore: ContextStore): void {
  contexts = newStore;
  logger.info("context store configured");
}

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
 * `ContextStore`). Mounting `createTelephonyRoutes`/`createStandaloneServer`
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
    // Snapshotted before deleting: `entries()` only promises a `Map`-like
    // *view*, and deleting mid-iteration is unspecified for anything else a
    // host might inject.
    for (const [phoneNumber, context] of Array.from(contexts.entries())) {
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
    logger.info("context created", { phoneNumber, channel });
  }

  context.lastActivity = Date.now();
  contexts.set(phoneNumber, context);
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
    contexts.set(phoneNumber, context);
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
  contexts.set(phoneNumber, context);
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
  contexts.set(phoneNumber, context);
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
  contexts.set(phoneNumber, context);
}

export function clearActiveFlow(phoneNumber: string): void {
  const context = contexts.get(phoneNumber);
  if (!context) return;

  logger.info("flow cleared", { phoneNumber, flowName: context.activeFlow?.flowName });
  context.activeFlow = null;
  contexts.set(phoneNumber, context);
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
  contexts.set(phoneNumber, context);
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
    contexts.set(phoneNumber, context);
  }
}

export function setLastPrompt(phoneNumber: string, prompt: string): void {
  const context = getOrCreateContext(phoneNumber);
  context.lastPrompt = prompt;
  contexts.set(phoneNumber, context);
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

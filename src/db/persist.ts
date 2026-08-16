/**
 * Session Persistence Helpers
 *
 * Non-blocking helpers that save conversation state through a `TalkerStore`.
 * Safe to call when no store is configured - the no-op store gracefully
 * skips every write.
 */

import { getConversation } from "../core/chatbot/conversations";
import { getContext, getMessageHistory, resolveLanguage } from "../core/context";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import type { Channel } from "../types";
import { resolveDefaultStore } from "./default-store";
import type { TalkerStore } from "./store";
import { generateSessionId } from "./store";

/**
 * Persist the current conversation state through `store`.
 *
 * `store` defaults to whatever the legacy singleton client (`./client.ts`)
 * resolves to when omitted - route handlers pass `deps.store` explicitly;
 * callers outside a mount (or tests using `setDbClient`) get the historical
 * fallback behavior. Awaits the session row write (so a caller that also
 * calls `persistFinalSession` right after can order the two - see its
 * docstring), but message inserts stay fire-and-forget since they don't
 * share a mutable field two calls could race on. Logs errors but never throws.
 */
export async function persistSession(
  phoneNumber: string,
  channel: Channel,
  store: TalkerStore = resolveDefaultStore(),
): Promise<void> {
  const context = getContext(phoneNumber);
  const language = resolveLanguage(phoneNumber);
  const messages = getMessageHistory(phoneNumber);

  if (!context || messages.length === 0) return;

  const normalizedPhone = phoneNumber.replace(/[^0-9]/g, "");
  const sessionId = generateSessionId(phoneNumber, context.createdAt);
  const now = Date.now();

  await store
    .upsertSession({
      id: sessionId,
      phoneNumber: normalizedPhone,
      channel,
      reason: "ended",
      language,
      startedAt: context.createdAt,
      endedAt: now,
      durationMs: now - context.createdAt,
      conversationId: getConversation(phoneNumber)?.conversationId,
    })
    .catch((err) => {
      logger.error("session persistence failed", { phoneNumber, error: getErrorMessage(err) });
    });

  for (const msg of messages) {
    const messageId = `${sessionId}-${msg.timestamp}-${msg.role}`;
    store
      .insertMessage({
        id: messageId,
        sessionId,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      })
      .catch((err) => {
        logger.error("message persistence failed", { phoneNumber, error: getErrorMessage(err) });
      });
  }
}

/**
 * Persist the final session state when a call completes.
 * Sets the reason and optional transfer reason.
 *
 * Writes the same session row `persistSession` does (upsert by session id),
 * so a caller that reports both the ongoing state and the final outcome for
 * one interaction must `await persistSession(...)` before calling this -
 * otherwise `persistSession`'s hardcoded `reason: "ended"` can complete after
 * this call's real reason and silently overwrite it (both are async database
 * writes with no ordering guarantee unless the caller imposes one). `store`
 * defaults the same way `persistSession`'s does; pass the same one to both
 * calls in one interaction.
 */
export function persistFinalSession(
  phoneNumber: string,
  channel: Channel,
  reason: "ended" | "redirected",
  transferReason?: string,
  store: TalkerStore = resolveDefaultStore(),
): void {
  const context = getContext(phoneNumber);
  const language = resolveLanguage(phoneNumber);

  if (!context) return;

  const normalizedPhone = phoneNumber.replace(/[^0-9]/g, "");
  const sessionId = generateSessionId(phoneNumber, context.createdAt);
  const now = Date.now();

  store
    .upsertSession({
      id: sessionId,
      phoneNumber: normalizedPhone,
      channel,
      reason,
      language,
      startedAt: context.createdAt,
      endedAt: now,
      durationMs: now - context.createdAt,
      transferReason,
      conversationId: getConversation(phoneNumber)?.conversationId,
    })
    .catch((err) => {
      logger.error("final session persistence failed", {
        phoneNumber,
        error: getErrorMessage(err),
      });
    });
}

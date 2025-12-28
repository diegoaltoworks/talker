/**
 * Session Persistence Helpers
 *
 * Non-blocking helpers that save conversation state to the database.
 * Safe to call when database is not configured — gracefully no-ops.
 */

import { getContext, getDetectedLanguage, getMessageHistory } from "../core/context";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import type { Channel } from "../types";
import { getDbClient } from "./client";
import { generateSessionId, insertMessage, upsertSession } from "./sessions";

/**
 * Persist the current conversation state to the database.
 * Non-blocking — fires and forgets. Logs errors but never throws.
 */
export function persistSession(
  phoneNumber: string,
  channel: Channel,
  conversationId?: string,
): void {
  const context = getContext(phoneNumber);
  const language = getDetectedLanguage(phoneNumber) || "en";
  const messages = getMessageHistory(phoneNumber);

  if (!context || messages.length === 0) return;
  if (!getDbClient()) return;

  const sanitizedPhone = phoneNumber.replace(/[^0-9]/g, "");
  const sessionId = generateSessionId(phoneNumber, context.createdAt);
  const now = Date.now();

  upsertSession({
    id: sessionId,
    phoneNumber: sanitizedPhone,
    channel,
    reason: "ended",
    language,
    startedAt: context.createdAt,
    endedAt: now,
    durationMs: now - context.createdAt,
    conversationId,
  }).catch((err) => {
    logger.error("session persistence failed", { phoneNumber, error: getErrorMessage(err) });
  });

  for (const msg of messages) {
    const messageId = `${sessionId}-${msg.timestamp}-${msg.role}`;
    insertMessage({
      id: messageId,
      sessionId,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }).catch((err) => {
      logger.error("message persistence failed", { phoneNumber, error: getErrorMessage(err) });
    });
  }
}

/**
 * Persist the final session state when a call completes.
 * Sets the reason and optional transfer reason.
 */
export function persistFinalSession(
  phoneNumber: string,
  channel: Channel,
  reason: "ended" | "redirected",
  transferReason?: string,
): void {
  const context = getContext(phoneNumber);
  const language = getDetectedLanguage(phoneNumber) || "en";

  if (!context) return;
  if (!getDbClient()) return;

  const sanitizedPhone = phoneNumber.replace(/[^0-9]/g, "");
  const sessionId = generateSessionId(phoneNumber, context.createdAt);
  const now = Date.now();

  upsertSession({
    id: sessionId,
    phoneNumber: sanitizedPhone,
    channel,
    reason,
    language,
    startedAt: context.createdAt,
    endedAt: now,
    durationMs: now - context.createdAt,
    transferReason,
  }).catch((err) => {
    logger.error("final session persistence failed", {
      phoneNumber,
      error: getErrorMessage(err),
    });
  });
}

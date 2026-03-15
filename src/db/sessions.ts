/**
 * Session Persistence
 *
 * Saves telephony sessions and messages to talker_sessions / talker_messages.
 * All operations are graceful — they return false/skip when the database is not configured.
 */

import { logger } from "../core/logger";
import type { Channel } from "../types";
import { getDbClient } from "./client";

export interface SessionRecord {
  id: string;
  phoneNumber: string;
  channel: Channel;
  reason: "ended" | "redirected";
  language: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  transferReason?: string;
  conversationId?: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function generateSessionId(phoneNumber: string, startTime: number): string {
  const sanitized = phoneNumber.replace(/[^0-9]/g, "");
  return `${sanitized}-${startTime}`;
}

/**
 * Upsert a session (insert or update)
 */
export async function upsertSession(session: SessionRecord): Promise<boolean> {
  const client = getDbClient();
  if (!client) return false;

  try {
    await client.execute({
      sql: `
        INSERT INTO talker_sessions (
          id, phone_number, channel, reason, language,
          started_at, ended_at, duration_ms, transfer_reason, conversation_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          channel = excluded.channel,
          reason = excluded.reason,
          language = excluded.language,
          ended_at = excluded.ended_at,
          duration_ms = excluded.duration_ms,
          transfer_reason = excluded.transfer_reason,
          conversation_id = excluded.conversation_id,
          updated_at = excluded.updated_at
      `,
      args: [
        session.id,
        session.phoneNumber,
        session.channel,
        session.reason,
        session.language,
        session.startedAt,
        session.endedAt,
        session.durationMs,
        session.transferReason || null,
        session.conversationId || null,
        Date.now(),
      ],
    });

    logger.info("session upserted", {
      sessionId: session.id,
      phoneNumber: session.phoneNumber,
      channel: session.channel,
    });
    return true;
  } catch (error) {
    logger.error("failed to upsert session", {
      sessionId: session.id,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

/**
 * Insert a single message (idempotent — skips duplicates)
 */
export async function insertMessage(message: MessageRecord): Promise<boolean> {
  const client = getDbClient();
  if (!client) return false;

  try {
    await client.execute({
      sql: `INSERT OR IGNORE INTO talker_messages (id, session_id, role, content, timestamp)
            VALUES (?, ?, ?, ?, ?)`,
      args: [message.id, message.sessionId, message.role, message.content, message.timestamp],
    });
    return true;
  } catch (error) {
    logger.error("failed to insert message", {
      messageId: message.id,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

/**
 * Save session and messages in one go
 */
export async function saveSessionWithMessages(
  session: SessionRecord,
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>,
): Promise<boolean> {
  const sessionSaved = await upsertSession(session);
  if (!sessionSaved) return false;

  for (const msg of messages) {
    const messageId = `${session.id}-${msg.timestamp}-${msg.role}`;
    await insertMessage({
      id: messageId,
      sessionId: session.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    });
  }

  return true;
}

/**
 * Update session incrementally after each interaction.
 * Called non-blocking after every call/sms exchange.
 */
export async function updateSessionIncremental(
  phoneNumber: string,
  channel: Channel,
  context: { createdAt: number },
  language: string,
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>,
  conversationId?: string,
): Promise<boolean> {
  const client = getDbClient();
  if (!client || messages.length === 0) return false;

  try {
    const sanitizedPhone = phoneNumber.replace(/[^0-9]/g, "");
    const sessionId = generateSessionId(phoneNumber, context.createdAt);
    const now = Date.now();

    await upsertSession({
      id: sessionId,
      phoneNumber: sanitizedPhone,
      channel,
      reason: "ended",
      language,
      startedAt: context.createdAt,
      endedAt: now,
      durationMs: now - context.createdAt,
      conversationId,
    });

    for (const msg of messages) {
      const messageId = `${sessionId}-${msg.timestamp}-${msg.role}`;
      await insertMessage({
        id: messageId,
        sessionId,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }

    return true;
  } catch (error) {
    logger.error("failed to update session incrementally", {
      phoneNumber,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

/**
 * Message delivery status record (from Twilio status callbacks)
 */
export interface MessageStatusRecord {
  messageSid: string;
  channel: "sms" | "whatsapp";
  from: string;
  to: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Upsert a message delivery status (from Twilio status callback)
 */
export async function upsertMessageStatus(record: MessageStatusRecord): Promise<boolean> {
  const client = getDbClient();
  if (!client) return false;

  try {
    await client.execute({
      sql: `
        INSERT INTO talker_message_status (
          message_sid, channel, phone_from, phone_to, status,
          error_code, error_message, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_sid) DO UPDATE SET
          status = excluded.status,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at
      `,
      args: [
        record.messageSid,
        record.channel,
        record.from,
        record.to,
        record.status,
        record.errorCode || null,
        record.errorMessage || null,
        Date.now(),
      ],
    });

    logger.info("message status upserted", {
      messageSid: record.messageSid,
      channel: record.channel,
      status: record.status,
    });
    return true;
  } catch (error) {
    logger.error("failed to upsert message status", {
      messageSid: record.messageSid,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

export { generateId };

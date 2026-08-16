/**
 * Session Persistence (legacy singleton-backed API)
 *
 * @deprecated Prefer `TalkerDependencies.store` (a `TalkerStore`, see
 * `./store.ts` and `./libsql-store.ts`) - route handlers already have one in
 * hand and it doesn't depend on this module's implicit global client. These
 * exports stay for hosts that called them directly before the store seam
 * existed, reading the legacy singleton client (`./client.ts`'s
 * `getDbClient()`) exactly as before - but note that in plugin mode the
 * singleton is populated only when `TalkerConfig.database` is set: the
 * default (reusing chatter's own connection to avoid a redundant second
 * one) no longer touches it. A plugin-mode host on this API needs its own
 * `database` config, or should migrate to `deps.store`.
 */

import { getDbClient } from "./client";
import { resolveDefaultStore } from "./default-store";
import {
  generateId,
  generateSessionId,
  type MessageRecord,
  type MessageStatusRecord,
  type SessionRecord,
} from "./store";

export type { MessageRecord, MessageStatusRecord, SessionRecord };
export { generateId, generateSessionId };

/** @deprecated Prefer `deps.store.upsertSession`. Upsert a session (insert or update). */
export async function upsertSession(session: SessionRecord): Promise<boolean> {
  return resolveDefaultStore().upsertSession(session);
}

/** @deprecated Prefer `deps.store.insertMessage`. Insert a single message (idempotent - skips duplicates). */
export async function insertMessage(message: MessageRecord): Promise<boolean> {
  return resolveDefaultStore().insertMessage(message);
}

/** @deprecated Prefer `deps.store.upsertMessageStatus`. Upsert a message delivery status (from Twilio status callback). */
export async function upsertMessageStatus(record: MessageStatusRecord): Promise<boolean> {
  return resolveDefaultStore().upsertMessageStatus(record);
}

/** @deprecated Prefer `deps.store`. Save session and messages in one go. */
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
 * @deprecated Prefer `deps.store`.
 *
 * Update session incrementally after each interaction. Called non-blocking
 * after every call/sms exchange.
 */
export async function updateSessionIncremental(
  phoneNumber: string,
  channel: SessionRecord["channel"],
  context: { createdAt: number },
  language: string,
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>,
  conversationId?: string,
): Promise<boolean> {
  if (!getDbClient() || messages.length === 0) return false;

  const store = resolveDefaultStore();
  const normalizedPhone = phoneNumber.replace(/[^0-9]/g, "");
  const sessionId = generateSessionId(phoneNumber, context.createdAt);
  const now = Date.now();

  await store.upsertSession({
    id: sessionId,
    phoneNumber: normalizedPhone,
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
    await store.insertMessage({
      id: messageId,
      sessionId,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    });
  }

  return true;
}

/**
 * TalkerStore
 *
 * Structural interface for session/message/status persistence - the
 * write-side counterpart to `ContextStore` (`src/core/context.ts`). Async,
 * matching the I/O it wraps, unlike `ContextStore`'s synchronous contract.
 *
 * `createLibsqlTalkerStore` (`./libsql-store.ts`) is the default
 * implementation, backed by Turso/libSQL. A host can inject another one via
 * `TalkerConfig.store` - to persist through a different database, add
 * instrumentation, or use a fake in tests. `createNullTalkerStore` is what
 * every mount falls back to when neither `store` nor `database` is
 * configured: every write resolves `false` without I/O, matching the
 * historical no-op-when-unconfigured behavior.
 */

import type { Channel, MessagingChannel } from "../types";

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

/** Message delivery status record (from Twilio status callbacks) */
export interface MessageStatusRecord {
  messageSid: string;
  channel: MessagingChannel;
  from: string;
  to: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface TalkerStore {
  upsertSession(session: SessionRecord): Promise<boolean>;
  insertMessage(message: MessageRecord): Promise<boolean>;
  upsertMessageStatus(record: MessageStatusRecord): Promise<boolean>;
}

/** Every write resolves `false` without I/O. Default when nothing is configured. */
export function createNullTalkerStore(): TalkerStore {
  return {
    upsertSession: async () => false,
    insertMessage: async () => false,
    upsertMessageStatus: async () => false,
  };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Strips formatting (+, spaces, dashes) so the same caller always produces
 * the same session id regardless of how Twilio punctuated the number this
 * time. Digits-only, not a privacy measure - the number is stored as
 * plaintext in `talker_sessions.phone_number` by design; log redaction is a
 * separate concern handled in ../core/logger.ts.
 */
export function generateSessionId(phoneNumber: string, startTime: number): string {
  const normalized = phoneNumber.replace(/[^0-9]/g, "");
  return `${normalized}-${startTime}`;
}

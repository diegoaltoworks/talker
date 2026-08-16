/**
 * Talker Database Schema
 *
 * Table names are single-sourced here and consumed by both `migrate.ts`
 * (DDL) and `libsql-store.ts` (queries), so the two cannot drift the way a
 * table name copy-pasted into each SQL string eventually does.
 */

export const TALKER_SESSIONS_TABLE = "talker_sessions";
export const TALKER_MESSAGES_TABLE = "talker_messages";
export const TALKER_MESSAGE_STATUS_TABLE = "talker_message_status";

/** Safe to run multiple times (every statement is IF NOT EXISTS). */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${TALKER_SESSIONS_TABLE} (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('call', 'sms', 'whatsapp')),
    reason TEXT NOT NULL CHECK(reason IN ('ended', 'redirected')),
    language TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    transfer_reason TEXT,
    conversation_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS ${TALKER_MESSAGES_TABLE} (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (session_id) REFERENCES ${TALKER_SESSIONS_TABLE}(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS ${TALKER_MESSAGE_STATUS_TABLE} (
    message_sid TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK(channel IN ('sms', 'whatsapp')),
    phone_from TEXT NOT NULL,
    phone_to TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS idx_talker_sessions_phone ON ${TALKER_SESSIONS_TABLE}(phone_number)`,
  `CREATE INDEX IF NOT EXISTS idx_talker_sessions_created ON ${TALKER_SESSIONS_TABLE}(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_talker_messages_session ON ${TALKER_MESSAGES_TABLE}(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_talker_messages_ts ON ${TALKER_MESSAGES_TABLE}(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_talker_message_status_phone ON ${TALKER_MESSAGE_STATUS_TABLE}(phone_to)`,
  `CREATE INDEX IF NOT EXISTS idx_talker_message_status_created ON ${TALKER_MESSAGE_STATUS_TABLE}(created_at DESC)`,
];

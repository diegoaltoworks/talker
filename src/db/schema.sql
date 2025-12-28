-- Talker Database Schema
-- Session and message persistence for telephony interactions
-- Tables are prefixed with talker_ to coexist with chatter in the same database

-- Sessions table: stores conversation metadata
CREATE TABLE IF NOT EXISTS talker_sessions (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('call', 'sms')),
  reason TEXT NOT NULL CHECK(reason IN ('ended', 'redirected')),
  language TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  transfer_reason TEXT,
  conversation_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Messages table: stores individual conversation messages
CREATE TABLE IF NOT EXISTS talker_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES talker_sessions(id) ON DELETE CASCADE
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_talker_sessions_phone ON talker_sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_talker_sessions_created ON talker_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talker_messages_session ON talker_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_talker_messages_ts ON talker_messages(timestamp);

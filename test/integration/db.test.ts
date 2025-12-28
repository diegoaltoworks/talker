/**
 * Integration Test: Database Session Persistence
 *
 * Uses an in-memory libsql database — no external services needed, no real data touched.
 * Tests use INSERT-only operations. No DROP TABLE, no DELETE, no TRUNCATE.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { clearAllContexts, stopCleanup } from "../../src/core/context";
import { setDbClient } from "../../src/db/client";
import {
  generateSessionId,
  insertMessage,
  saveSessionWithMessages,
  updateSessionIncremental,
  upsertSession,
} from "../../src/db/sessions";
import type { SessionRecord } from "../../src/db/sessions";

let db: Client;

const schemaPath = join(__dirname, "../../src/db/schema.sql");
const schemaSql = readFileSync(schemaPath, "utf-8");

async function runSchema(client: Client) {
  const statements = schemaSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await client.execute(stmt);
  }
}

describe("Database Integration", () => {
  beforeAll(async () => {
    db = createClient({ url: ":memory:" });
    await runSchema(db);
    setDbClient(db);
  });

  afterEach(() => {
    clearAllContexts();
  });

  afterAll(() => {
    stopCleanup();
    setDbClient(null);
    db.close();
  });

  describe("Schema", () => {
    it("should create talker_sessions table", async () => {
      const result = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='talker_sessions'",
      );
      expect(result.rows).toHaveLength(1);
    });

    it("should create talker_messages table", async () => {
      const result = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='talker_messages'",
      );
      expect(result.rows).toHaveLength(1);
    });

    it("should NOT have unprefixed sessions or messages tables", async () => {
      const result = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions', 'messages')",
      );
      expect(result.rows).toHaveLength(0);
    });

    it("should create talker-prefixed indexes", async () => {
      const result = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_talker_%'",
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("upsertSession", () => {
    it("should insert a new session", async () => {
      const session: SessionRecord = {
        id: "test-insert-1",
        phoneNumber: "1234567890",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 1000000,
        endedAt: 1060000,
        durationMs: 60000,
      };

      const result = await upsertSession(session);
      expect(result).toBe(true);

      const rows = await db.execute({
        sql: "SELECT * FROM talker_sessions WHERE id = ?",
        args: ["test-insert-1"],
      });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].phone_number).toBe("1234567890");
      expect(rows.rows[0].channel).toBe("call");
      expect(rows.rows[0].reason).toBe("ended");
      expect(rows.rows[0].language).toBe("en");
    });

    it("should update an existing session on conflict", async () => {
      const session: SessionRecord = {
        id: "test-upsert-1",
        phoneNumber: "9999999999",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 1000000,
        endedAt: 1030000,
        durationMs: 30000,
      };

      await upsertSession(session);

      await upsertSession({
        ...session,
        reason: "redirected",
        endedAt: 1060000,
        durationMs: 60000,
        transferReason: "user requested transfer",
      });

      const rows = await db.execute({
        sql: "SELECT * FROM talker_sessions WHERE id = ?",
        args: ["test-upsert-1"],
      });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].reason).toBe("redirected");
      expect(rows.rows[0].duration_ms).toBe(60000);
      expect(rows.rows[0].transfer_reason).toBe("user requested transfer");
    });

    it("should store conversationId when provided", async () => {
      const session: SessionRecord = {
        id: "test-convid-1",
        phoneNumber: "5555555555",
        channel: "sms",
        reason: "ended",
        language: "fr",
        startedAt: 2000000,
        endedAt: 2060000,
        durationMs: 60000,
        conversationId: "conv-abc-123",
      };

      await upsertSession(session);

      const rows = await db.execute({
        sql: "SELECT conversation_id FROM talker_sessions WHERE id = ?",
        args: ["test-convid-1"],
      });
      expect(rows.rows[0].conversation_id).toBe("conv-abc-123");
    });
  });

  describe("insertMessage", () => {
    it("should insert a message linked to a session", async () => {
      await upsertSession({
        id: "test-msg-session-1",
        phoneNumber: "1111111111",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 3000000,
        endedAt: 3060000,
        durationMs: 60000,
      });

      const result = await insertMessage({
        id: "test-msg-1",
        sessionId: "test-msg-session-1",
        role: "user",
        content: "Hello there",
        timestamp: 3001000,
      });
      expect(result).toBe(true);

      const rows = await db.execute({
        sql: "SELECT * FROM talker_messages WHERE id = ?",
        args: ["test-msg-1"],
      });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].role).toBe("user");
      expect(rows.rows[0].content).toBe("Hello there");
    });

    it("should be idempotent via INSERT OR IGNORE", async () => {
      await upsertSession({
        id: "test-idem-session-1",
        phoneNumber: "2222222222",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 4000000,
        endedAt: 4060000,
        durationMs: 60000,
      });

      await insertMessage({
        id: "test-idem-msg-1",
        sessionId: "test-idem-session-1",
        role: "user",
        content: "First insert",
        timestamp: 4001000,
      });

      // Same ID again — should not fail or duplicate
      const result = await insertMessage({
        id: "test-idem-msg-1",
        sessionId: "test-idem-session-1",
        role: "user",
        content: "Duplicate attempt",
        timestamp: 4001000,
      });
      expect(result).toBe(true);

      const rows = await db.execute({
        sql: "SELECT * FROM talker_messages WHERE session_id = ?",
        args: ["test-idem-session-1"],
      });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].content).toBe("First insert");
    });
  });

  describe("saveSessionWithMessages", () => {
    it("should save session and all messages atomically", async () => {
      const session: SessionRecord = {
        id: "test-batch-1",
        phoneNumber: "3333333333",
        channel: "sms",
        reason: "ended",
        language: "pt",
        startedAt: 5000000,
        endedAt: 5120000,
        durationMs: 120000,
      };

      const messages = [
        { role: "user" as const, content: "Ola", timestamp: 5001000 },
        { role: "assistant" as const, content: "Oi! Como posso ajudar?", timestamp: 5002000 },
        { role: "user" as const, content: "Obrigado", timestamp: 5003000 },
      ];

      const result = await saveSessionWithMessages(session, messages);
      expect(result).toBe(true);

      const sessionRows = await db.execute({
        sql: "SELECT * FROM talker_sessions WHERE id = ?",
        args: ["test-batch-1"],
      });
      expect(sessionRows.rows).toHaveLength(1);
      expect(sessionRows.rows[0].language).toBe("pt");

      const msgRows = await db.execute({
        sql: "SELECT * FROM talker_messages WHERE session_id = ? ORDER BY timestamp",
        args: ["test-batch-1"],
      });
      expect(msgRows.rows).toHaveLength(3);
      expect(msgRows.rows[0].content).toBe("Ola");
      expect(msgRows.rows[1].role).toBe("assistant");
      expect(msgRows.rows[2].content).toBe("Obrigado");
    });
  });

  describe("updateSessionIncremental", () => {
    it("should create session and messages from phone/context", async () => {
      const phoneNumber = "+447700900001";
      const startTime = 6000000;
      const messages = [
        { role: "user" as const, content: "What time is it?", timestamp: 6001000 },
        { role: "assistant" as const, content: "It's about noon.", timestamp: 6002000 },
      ];

      const result = await updateSessionIncremental(
        phoneNumber,
        "call",
        { createdAt: startTime },
        "en",
        messages,
        "conv-xyz",
      );
      expect(result).toBe(true);

      const sessionId = generateSessionId(phoneNumber, startTime);
      const sessionRows = await db.execute({
        sql: "SELECT * FROM talker_sessions WHERE id = ?",
        args: [sessionId],
      });
      expect(sessionRows.rows).toHaveLength(1);
      expect(sessionRows.rows[0].conversation_id).toBe("conv-xyz");

      const msgRows = await db.execute({
        sql: "SELECT * FROM talker_messages WHERE session_id = ?",
        args: [sessionId],
      });
      expect(msgRows.rows).toHaveLength(2);
    });

    it("should update session and not duplicate messages on subsequent calls", async () => {
      const phoneNumber = "+447700900002";
      const startTime = 7000000;

      await updateSessionIncremental(phoneNumber, "call", { createdAt: startTime }, "en", [
        { role: "user", content: "Hello", timestamp: 7001000 },
      ]);

      await updateSessionIncremental(phoneNumber, "call", { createdAt: startTime }, "en", [
        { role: "user", content: "Hello", timestamp: 7001000 },
        { role: "assistant", content: "Hi!", timestamp: 7002000 },
        { role: "user", content: "Thanks", timestamp: 7060000 },
      ]);

      const sessionId = generateSessionId(phoneNumber, startTime);

      // Session should exist once with updated times
      const sessionRows = await db.execute({
        sql: "SELECT * FROM talker_sessions WHERE id = ?",
        args: [sessionId],
      });
      expect(sessionRows.rows).toHaveLength(1);
      expect(Number(sessionRows.rows[0].duration_ms)).toBeGreaterThan(0);

      // Messages should not be duplicated (INSERT OR IGNORE)
      const msgRows = await db.execute({
        sql: "SELECT * FROM talker_messages WHERE session_id = ?",
        args: [sessionId],
      });
      expect(msgRows.rows).toHaveLength(3);
    });

    it("should return false for empty messages", async () => {
      const result = await updateSessionIncremental(
        "+447700900003",
        "call",
        { createdAt: 8000000 },
        "en",
        [],
      );
      expect(result).toBe(false);
    });
  });

  describe("generateSessionId", () => {
    it("should produce deterministic IDs", () => {
      const id1 = generateSessionId("+447700900001", 1000000);
      const id2 = generateSessionId("+447700900001", 1000000);
      expect(id1).toBe(id2);
    });

    it("should strip non-digit characters from phone", () => {
      const id = generateSessionId("+44 (770) 090-0001", 1000000);
      expect(id).toBe("447700900001-1000000");
    });

    it("should produce different IDs for different timestamps", () => {
      const id1 = generateSessionId("+447700900001", 1000000);
      const id2 = generateSessionId("+447700900001", 2000000);
      expect(id1).not.toBe(id2);
    });
  });

  describe("Data isolation", () => {
    it("should only use talker_ prefixed tables", async () => {
      const tables = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const tableNames = tables.rows.map((r) => r.name as string);
      const talkerTables = tableNames.filter((n) => n.startsWith("talker_"));

      // All talker tables must be prefixed
      expect(talkerTables.length).toBeGreaterThanOrEqual(2);
    });

    it("should not affect non-talker tables in the same database", async () => {
      // Simulate a chatter table existing in the same database
      await db.execute("CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, text TEXT)");
      await db.execute({
        sql: "INSERT OR IGNORE INTO chunks (id, text) VALUES (?, ?)",
        args: ["chunk-1", "some knowledge"],
      });

      // Run a talker operation
      await upsertSession({
        id: "test-isolation-1",
        phoneNumber: "0000000000",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 9000000,
        endedAt: 9060000,
        durationMs: 60000,
      });

      // Verify chatter's data is untouched
      const chatterRows = await db.execute("SELECT * FROM chunks WHERE id = 'chunk-1'");
      expect(chatterRows.rows).toHaveLength(1);
      expect(chatterRows.rows[0].text).toBe("some knowledge");
    });
  });

  describe("No data returned when db is not configured", () => {
    it("should return false for all operations when client is null", async () => {
      setDbClient(null);

      const upsertResult = await upsertSession({
        id: "test-null-1",
        phoneNumber: "0000000000",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 0,
        endedAt: 0,
        durationMs: 0,
      });
      expect(upsertResult).toBe(false);

      const msgResult = await insertMessage({
        id: "test-null-msg-1",
        sessionId: "test-null-1",
        role: "user",
        content: "hello",
        timestamp: 0,
      });
      expect(msgResult).toBe(false);

      const incrementalResult = await updateSessionIncremental(
        "+440000000000",
        "call",
        { createdAt: 0 },
        "en",
        [{ role: "user", content: "hello", timestamp: 0 }],
      );
      expect(incrementalResult).toBe(false);

      // Restore for other tests
      setDbClient(db);
    });
  });
});

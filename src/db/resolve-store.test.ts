/**
 * resolveStore Tests
 *
 * Covers the priority order a mount resolves its `TalkerStore` in:
 * bring-your-own `config.store`, then `config.database` (talker's own
 * connection), then a live client to reuse (chatter's `deps.db` in plugin
 * mode - the fix for the historical double-connection bug), then a no-op.
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "@libsql/client";
import { logger } from "../core/logger";
import { getDbClient, setDbClient } from "./client";
import { resolveStore } from "./resolve-store";
import type { TalkerStore } from "./store";

function fakeClient(onExecute: (sql: string) => void): Client {
  return {
    execute: async (query: unknown) => {
      const sql = typeof query === "string" ? query : (query as { sql: string }).sql;
      onExecute(sql);
      return {} as ReturnType<Client["execute"]> extends Promise<infer T> ? T : never;
    },
    close: () => {},
  } as unknown as Client;
}

describe("resolveStore", () => {
  afterEach(() => {
    setDbClient(null);
  });

  it("returns config.store as-is, touching neither database nor the live client", async () => {
    const fakeStore: TalkerStore = {
      upsertSession: async () => true,
      insertMessage: async () => true,
      upsertMessageStatus: async () => true,
    };
    const liveExecutions: string[] = [];
    const liveClient = fakeClient((sql) => liveExecutions.push(sql));

    const store = await resolveStore({ store: fakeStore }, liveClient);

    expect(store).toBe(fakeStore);
    expect(liveExecutions).toEqual([]);
    expect(getDbClient()).toBeNull();
  });

  it("reuses the live client and opens zero extra connections when config.database is unset", async () => {
    const liveExecutions: string[] = [];
    const liveClient = fakeClient((sql) => liveExecutions.push(sql));

    const store = await resolveStore({}, liveClient);

    // Migrations ran against the live client (proves the store is wired to
    // it), and the legacy singleton was never touched - no second connection.
    expect(liveExecutions.length).toBeGreaterThan(0);
    expect(getDbClient()).toBeNull();

    liveExecutions.length = 0;
    await store.upsertSession({
      id: "s1",
      phoneNumber: "15551234567",
      channel: "call",
      reason: "ended",
      language: "en",
      startedAt: 0,
      endedAt: 1,
      durationMs: 1,
    });
    expect(liveExecutions.some((sql) => sql.includes("talker_sessions"))).toBe(true);
  });

  it("prefers config.database over the live client when both are present", async () => {
    const liveExecutions: string[] = [];
    const liveClient = fakeClient((sql) => liveExecutions.push(sql));

    // No singleton pre-set, so this exercises the real initDbClient path -
    // an in-memory database is fast and needs no external service.
    setDbClient(null);

    const store = await resolveStore(
      { database: { url: ":memory:", authToken: "unused" } },
      liveClient,
    );

    // config.database's own connection did the write; the live client (what
    // a vacuous "did it fall through to the no-op instead" pass would also
    // satisfy) never saw any SQL.
    expect(liveExecutions).toEqual([]);
    expect(
      await store.upsertSession({
        id: "s1",
        phoneNumber: "15551234567",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 0,
        endedAt: 1,
        durationMs: 1,
      }),
    ).toBe(true);

    const rows = await getDbClient()?.execute("SELECT id FROM talker_sessions WHERE id = 's1'");
    expect(rows?.rows.length).toBe(1);

    getDbClient()?.close();
  });

  it("warns and falls through when only half a database config is set", async () => {
    const warnings: string[] = [];
    const warn = spyOn(logger, "warn").mockImplementation((message: string) => {
      warnings.push(message);
    });

    try {
      // The realistic shape: both keys typed and present, one of them read
      // from an env var that was never set.
      const store = await resolveStore({ database: { url: "libsql://only-a-url", authToken: "" } });

      // Falls through rather than refusing to mount: a missing credential is
      // not worth declining to answer calls over.
      expect(
        await store.upsertSession({
          id: "s1",
          phoneNumber: "1",
          channel: "call",
          reason: "ended",
          language: "en",
          startedAt: 0,
          endedAt: 1,
          durationMs: 1,
        }),
      ).toBe(false);
      expect(getDbClient()).toBeNull();
      expect(warnings.join("\n")).toContain("database config is incomplete");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent when no database config is set at all", async () => {
    const warnings: string[] = [];
    const warn = spyOn(logger, "warn").mockImplementation((message: string) => {
      warnings.push(message);
    });

    try {
      await resolveStore({});
      expect(warnings).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("returns a no-op store when nothing is configured", async () => {
    const store = await resolveStore({});

    expect(
      await store.upsertSession({
        id: "s1",
        phoneNumber: "1",
        channel: "call",
        reason: "ended",
        language: "en",
        startedAt: 0,
        endedAt: 1,
        durationMs: 1,
      }),
    ).toBe(false);
    expect(
      await store.insertMessage({
        id: "m1",
        sessionId: "s1",
        role: "user",
        content: "hi",
        timestamp: 0,
      }),
    ).toBe(false);
    expect(
      await store.upsertMessageStatus({
        messageSid: "SM1",
        channel: "sms",
        from: "+1",
        to: "+2",
        status: "sent",
      }),
    ).toBe(false);
  });
});

/**
 * Session Persistence Ordering Tests
 *
 * persistSession always upserts reason: "ended"; persistFinalSession upserts
 * the real terminal reason ("ended" or "redirected") to the same row right
 * after. Both are async database writes - without the caller awaiting
 * persistSession first, persistFinalSession's write could complete before
 * persistSession's and get silently clobbered by the generic "ended". These
 * tests pin the fixed call pattern: await persistSession, then call
 * persistFinalSession.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { Client } from "@libsql/client";
import { addMessage, clearAllContexts, getOrCreateContext } from "../core/context";
import { setDbClient } from "./client";
import { persistFinalSession, persistSession } from "./persist";

function fakeClient(onWrite: (reason: string) => void, delayMs: Record<string, number>): Client {
  return {
    execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
      // Only the talker_sessions upsert carries a "reason" - ignore the
      // talker_messages inserts persistSession also fires off.
      if (!sql.includes("talker_sessions")) {
        return {} as ReturnType<Client["execute"]> extends Promise<infer T> ? T : never;
      }
      const reason = args[3] as string;
      await new Promise((r) => setTimeout(r, delayMs[reason] ?? 0));
      onWrite(reason);
      return {} as ReturnType<Client["execute"]> extends Promise<infer T> ? T : never;
    },
    close: () => {},
  } as unknown as Client;
}

describe("persistSession / persistFinalSession ordering", () => {
  afterEach(() => {
    clearAllContexts();
    setDbClient(null);
  });

  it("preserves the final reason when persistSession is awaited first, even if its write is slower", async () => {
    const writes: string[] = [];
    // persistSession's "ended" write is deliberately the slow one - if the
    // caller didn't await it, persistFinalSession's faster "redirected"
    // write would land first and then get overwritten.
    setDbClient(fakeClient((reason) => writes.push(reason), { ended: 15, redirected: 0 }));

    const phoneNumber = "+15551234567";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "put me through to a person", "call");

    await persistSession(phoneNumber, "call");
    persistFinalSession(phoneNumber, "call", "redirected", "asked for a human");

    await new Promise((r) => setTimeout(r, 30));

    expect(writes).toEqual(["ended", "redirected"]);
  });

  it("persistSession's returned promise resolves only after its own write completes", async () => {
    const writes: string[] = [];
    setDbClient(fakeClient((reason) => writes.push(reason), { ended: 15 }));

    const phoneNumber = "+15557654321";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "hello", "call");

    await persistSession(phoneNumber, "call");

    expect(writes).toEqual(["ended"]);
  });
});

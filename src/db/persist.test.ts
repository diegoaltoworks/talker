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
import { clearAllConversations, getOrCreateConversation } from "../core/chatbot/conversations";
import { addMessage, clearAllContexts, getOrCreateContext } from "../core/context";
import { setDbClient } from "./client";
import { persistFinalSession, persistSession } from "./persist";

/** Captures every `talker_sessions` upsert's full arg tuple; ignores the `talker_messages` inserts persistSession also fires off. */
function sessionWriteCapturingClient(
  onWrite: (args: unknown[]) => void,
  delayMs: Record<string, number> = {},
): Client {
  return {
    execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
      if (!sql.includes("talker_sessions")) {
        return {} as ReturnType<Client["execute"]> extends Promise<infer T> ? T : never;
      }
      const reason = args[3] as string;
      await new Promise((r) => setTimeout(r, delayMs[reason] ?? 0));
      onWrite(args);
      return {} as ReturnType<Client["execute"]> extends Promise<infer T> ? T : never;
    },
    close: () => {},
  } as unknown as Client;
}

describe("persistSession / persistFinalSession ordering", () => {
  afterEach(() => {
    clearAllContexts();
    clearAllConversations();
    setDbClient(null);
  });

  it("preserves the final reason when persistSession is awaited first, even if its write is slower", async () => {
    const reasons: string[] = [];
    // persistSession's "ended" write is deliberately the slow one - if the
    // caller didn't await it, persistFinalSession's faster "redirected"
    // write would land first and then get overwritten.
    setDbClient(
      sessionWriteCapturingClient((args) => reasons.push(args[3] as string), {
        ended: 15,
        redirected: 0,
      }),
    );

    const phoneNumber = "+15551234567";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "put me through to a person", "call");

    await persistSession(phoneNumber, "call");
    persistFinalSession(phoneNumber, "call", "redirected", "asked for a human");

    await new Promise((r) => setTimeout(r, 30));

    expect(reasons).toEqual(["ended", "redirected"]);
  });

  it("persistSession's returned promise resolves only after its own write completes", async () => {
    const reasons: string[] = [];
    setDbClient(
      sessionWriteCapturingClient((args) => reasons.push(args[3] as string), { ended: 15 }),
    );

    const phoneNumber = "+15557654321";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "hello", "call");

    await persistSession(phoneNumber, "call");

    expect(reasons).toEqual(["ended"]);
  });
});

describe("persistSession / persistFinalSession conversationId", () => {
  afterEach(() => {
    clearAllContexts();
    clearAllConversations();
    setDbClient(null);
  });

  it("reads the caller's chatbot conversation id onto the persisted session row", async () => {
    const conversationIds: unknown[] = [];
    setDbClient(sessionWriteCapturingClient((args) => conversationIds.push(args[9])));

    const phoneNumber = "+15559876543";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "hello", "call");
    const { conversationId } = getOrCreateConversation(phoneNumber);

    await persistSession(phoneNumber, "call");

    expect(conversationIds).toEqual([conversationId]);
  });

  it("persistFinalSession reads the same ambient conversation id, so it cannot clobber persistSession's write", async () => {
    const conversationIds: unknown[] = [];
    setDbClient(sessionWriteCapturingClient((args) => conversationIds.push(args[9])));

    const phoneNumber = "+15551112222";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "put me through to a person", "call");
    const { conversationId } = getOrCreateConversation(phoneNumber);

    await persistSession(phoneNumber, "call");
    persistFinalSession(phoneNumber, "call", "redirected", "asked for a human");
    await new Promise((r) => setTimeout(r, 0));

    expect(conversationIds).toEqual([conversationId, conversationId]);
  });

  it("persists no conversation id when the caller never used the standalone chatbot HTTP client", async () => {
    const conversationIds: unknown[] = [];
    setDbClient(sessionWriteCapturingClient((args) => conversationIds.push(args[9])));

    const phoneNumber = "+15550001111";
    getOrCreateContext(phoneNumber, "call");
    addMessage(phoneNumber, "user", "hello", "call");

    await persistSession(phoneNumber, "call");

    expect(conversationIds).toEqual([null]);
  });
});

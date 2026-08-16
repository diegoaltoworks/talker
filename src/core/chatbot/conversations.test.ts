import { afterEach, describe, expect, it } from "bun:test";
import {
  clearAllConversations,
  getConversation,
  getOrCreateConversation,
  sweepConversations,
} from "./conversations";

describe("sweepConversations", () => {
  afterEach(() => {
    clearAllConversations();
  });

  it("deletes a conversation idle for longer than ttlMs", () => {
    const conversation = getOrCreateConversation("+1234567890");
    conversation.lastActivityAt = Date.now() - 10_000;

    sweepConversations(1000);

    expect(getConversation("+1234567890")).toBeUndefined();
  });

  it("keeps a conversation active within ttlMs", () => {
    getOrCreateConversation("+1234567890");

    sweepConversations(60_000);

    expect(getConversation("+1234567890")).toBeDefined();
  });

  it("sweeps only the stale entries, leaving fresh ones untouched", () => {
    const stale = getOrCreateConversation("+1111111111");
    stale.lastActivityAt = Date.now() - 10_000;
    getOrCreateConversation("+2222222222");

    sweepConversations(1000);

    expect(getConversation("+1111111111")).toBeUndefined();
    expect(getConversation("+2222222222")).toBeDefined();
  });
});

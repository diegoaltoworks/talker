import { describe, expect, it } from "bun:test";
import { createNullTalkerStore } from "./store";

describe("createNullTalkerStore", () => {
  it("resolves every write to false without throwing", async () => {
    const store = createNullTalkerStore();

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

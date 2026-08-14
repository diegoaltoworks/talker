/**
 * Message Tap Tests
 *
 * Tests for the onMessage tap helper.
 */

import { describe, expect, it } from "bun:test";
import type { MessageTapEvent, TalkerConfig } from "../types";
import { emitMessageTap } from "./message-tap";

const BASE_EVENT: Omit<MessageTapEvent, "timestamp"> = {
  direction: "inbound",
  channel: "sms",
  from: "+15551234567",
  to: "+15559876543",
  body: "Hello",
};

describe("emitMessageTap", () => {
  it("does nothing when onMessage is not configured", () => {
    expect(() => emitMessageTap({}, BASE_EVENT)).not.toThrow();
  });

  it("invokes onMessage with a timestamped event", async () => {
    const events: MessageTapEvent[] = [];
    const config: TalkerConfig = { onMessage: (event) => void events.push(event) };

    emitMessageTap(config, BASE_EVENT);
    await Promise.resolve();
    await Promise.resolve();

    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject(BASE_EVENT);
    expect(typeof events[0].timestamp).toBe("number");
  });

  it("supports an async onMessage handler", async () => {
    const events: MessageTapEvent[] = [];
    const config: TalkerConfig = {
      onMessage: async (event) => {
        events.push(event);
      },
    };

    emitMessageTap(config, { ...BASE_EVENT, direction: "outbound" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events.length).toBe(1);
    expect(events[0].direction).toBe("outbound");
  });

  it("swallows a throwing handler without rejecting or throwing", async () => {
    const config: TalkerConfig = {
      onMessage: () => {
        throw new Error("tap handler exploded");
      },
    };

    expect(() => emitMessageTap(config, BASE_EVENT)).not.toThrow();
    // Let the fire-and-forget microtask settle before finishing the test.
    await Promise.resolve();
    await Promise.resolve();
  });

  it("swallows a rejecting async handler without an unhandled rejection", async () => {
    const config: TalkerConfig = {
      onMessage: async () => {
        throw new Error("async tap handler exploded");
      },
    };

    expect(() => emitMessageTap(config, BASE_EVENT)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
});

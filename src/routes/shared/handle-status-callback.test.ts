/**
 * Status Callback Handler Tests
 *
 * Tests for the shared message status callback handler.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../core/context";
import type { MessageStatusEvent, TalkerDependencies } from "../../types";
import { handleStatusCallback } from "./handle-status-callback";

function createTestDeps(onMessageStatus?: (event: MessageStatusEvent) => void): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      onMessageStatus,
    },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function createApp(deps: TalkerDependencies, channel: "sms" | "whatsapp") {
  const app = new Hono();
  app.post("/status", (c) => handleStatusCallback(c, deps, channel));
  return app;
}

function postStatus(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleStatusCallback", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("should return 200 for a valid SMS status callback", async () => {
    const deps = createTestDeps();
    const app = createApp(deps, "sms");

    const res = await postStatus(app, {
      MessageSid: "SM123abc",
      MessageStatus: "delivered",
      From: "+15551234567",
      To: "+15559876543",
    });

    expect(res.status).toBe(200);
  });

  it("should return 200 for a valid WhatsApp status callback", async () => {
    const deps = createTestDeps();
    const app = createApp(deps, "whatsapp");

    const res = await postStatus(app, {
      MessageSid: "SM456def",
      MessageStatus: "read",
      From: "whatsapp:+15551234567",
      To: "whatsapp:+15559876543",
    });

    expect(res.status).toBe(200);
  });

  it("should return 200 even with missing fields", async () => {
    const deps = createTestDeps();
    const app = createApp(deps, "sms");

    const res = await postStatus(app, {});

    expect(res.status).toBe(200);
  });

  it("should invoke onMessageStatus callback when configured", async () => {
    const events: MessageStatusEvent[] = [];
    const deps = createTestDeps((event) => {
      events.push(event);
    });
    const app = createApp(deps, "sms");

    await postStatus(app, {
      MessageSid: "SM789ghi",
      MessageStatus: "failed",
      From: "+15551234567",
      To: "+15559876543",
      ErrorCode: "30001",
      ErrorMessage: "Queue overflow",
    });

    expect(events.length).toBe(1);
    expect(events[0].messageSid).toBe("SM789ghi");
    expect(events[0].messageStatus).toBe("failed");
    expect(events[0].channel).toBe("sms");
    expect(events[0].from).toBe("+15551234567");
    expect(events[0].to).toBe("+15559876543");
    expect(events[0].errorCode).toBe("30001");
    expect(events[0].errorMessage).toBe("Queue overflow");
  });

  it("should invoke async onMessageStatus callback", async () => {
    const events: MessageStatusEvent[] = [];
    const deps = createTestDeps(async (event) => {
      events.push(event);
    });
    const app = createApp(deps, "whatsapp");

    await postStatus(app, {
      MessageSid: "SM321xyz",
      MessageStatus: "sent",
      From: "whatsapp:+15551234567",
      To: "whatsapp:+15559876543",
    });

    expect(events.length).toBe(1);
    expect(events[0].messageSid).toBe("SM321xyz");
    expect(events[0].channel).toBe("whatsapp");
    // WhatsApp prefix should be stripped
    expect(events[0].from).toBe("+15551234567");
    expect(events[0].to).toBe("+15559876543");
  });

  it("should not throw when onMessageStatus callback throws", async () => {
    const deps = createTestDeps(() => {
      throw new Error("Callback error");
    });
    const app = createApp(deps, "sms");

    const res = await postStatus(app, {
      MessageSid: "SM000fail",
      MessageStatus: "delivered",
      From: "+15551234567",
      To: "+15559876543",
    });

    expect(res.status).toBe(200);
  });

  it("should handle all Twilio message statuses", async () => {
    const statuses = ["queued", "sending", "sent", "delivered", "undelivered", "failed", "read"];
    const deps = createTestDeps();
    const app = createApp(deps, "whatsapp");

    for (const status of statuses) {
      const res = await postStatus(app, {
        MessageSid: `SM-${status}`,
        MessageStatus: status,
        From: "whatsapp:+15551234567",
        To: "whatsapp:+15559876543",
      });
      expect(res.status).toBe(200);
    }
  });
});

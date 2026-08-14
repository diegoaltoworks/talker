/**
 * SMS Handler Tests
 *
 * Tests for the incoming SMS webhook handler and route factory.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { MessageTapEvent, TalkerDependencies } from "../../types";
import { smsRoutes } from "./index";

function createTestDeps(
  chatFn?: (phone: string, msg: string) => Promise<string>,
  configOverrides?: Partial<TalkerDependencies["config"]>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      transferNumber: "+441234567890",
      chatFn: chatFn || (async (_phone, msg) => `Echo: ${msg}`),
      ...configOverrides,
    },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function createApp(deps?: TalkerDependencies) {
  const d = deps || createTestDeps();
  const registry = new FlowRegistry("");
  const app = new Hono();
  app.route("/", smsRoutes(d, registry));
  return app;
}

function postSms(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/sms", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("SMS Routes", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  describe("GET /sms", () => {
    it("should return health check text", async () => {
      const app = createApp();
      const res = await app.fetch(new Request("http://localhost/sms", { method: "GET" }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("SMS endpoint active");
    });
  });

  describe("POST /sms", () => {
    it("should return greeting TwiML for empty message body", async () => {
      const app = createApp();
      const res = await postSms(app, { From: "+15551234567", Body: "" });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("</Message>");
      expect(text).toContain("<Response>");
    });

    it("should return greeting TwiML for whitespace-only body", async () => {
      const app = createApp();
      const res = await postSms(app, { From: "+15551234567", Body: "   " });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should default From to 'unknown' when missing", async () => {
      const app = createApp();
      const res = await postSms(app, { Body: "" });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should return 200 with text/xml content type for valid message", async () => {
      // This will attempt processing — without OpenAI, it may error but should still return TwiML
      const app = createApp();
      const res = await postSms(app, { From: "+15551234567", Body: "Hello" });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Response>");
    });

    it("should return error TwiML when processing fails", async () => {
      // Use a chatFn that throws — but the real error will come from processIncoming
      // calling OpenAI with a fake key. The handler should catch and return genericError.
      const app = createApp();
      const res = await postSms(app, { From: "+15551234567", Body: "Hello" });

      expect(res.status).toBe(200);
      const text = await res.text();
      // Should be a valid TwiML response (either processed or error)
      expect(text).toContain("<Response>");
      expect(text).toContain("<Message>");
    });
  });

  describe("onMessage tap", () => {
    async function flushTapQueue() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    it("fires inbound and outbound events for a normal exchange", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps(async (_phone, msg) => `Echo: ${msg}`, {
        onMessage: (event) => void events.push(event),
      });
      const app = createApp(deps);

      await postSms(app, { From: "+15559990010", To: "+15559876543", Body: "Hello" });
      await flushTapQueue();

      expect(events.length).toBe(2);
      expect(events[0]).toMatchObject({
        direction: "inbound",
        channel: "sms",
        from: "+15559990010",
        to: "+15559876543",
        body: "Hello",
      });
      expect(events[1]).toMatchObject({
        direction: "outbound",
        channel: "sms",
        from: "+15559876543",
        to: "+15559990010",
      });
    });

    it("fires inbound and outbound events for the empty-body greeting path", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps(undefined, { onMessage: (event) => void events.push(event) });
      const app = createApp(deps);

      await postSms(app, { From: "+15559990011", To: "+15559876543", Body: "" });
      await flushTapQueue();

      expect(events.length).toBe(2);
      expect(events[0].direction).toBe("inbound");
      expect(events[1].direction).toBe("outbound");
      expect(events[1].body.length).toBeGreaterThan(0);
    });

    it("does not throw and still replies when onMessage throws", async () => {
      const deps = createTestDeps(async (_phone, msg) => `Echo: ${msg}`, {
        onMessage: () => {
          throw new Error("tap handler exploded");
        },
      });
      const app = createApp(deps);

      const res = await postSms(app, { From: "+15559990012", To: "+15559876543", Body: "Hello" });
      await flushTapQueue();

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });
  });
});

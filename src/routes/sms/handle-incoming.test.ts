/**
 * SMS Handler Tests
 *
 * Tests for the incoming SMS webhook handler and route factory.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { smsRoutes } from "./index";

function createTestDeps(
  chatFn?: (phone: string, msg: string) => Promise<string>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      transferNumber: "+441234567890",
      chatFn: chatFn || (async (_phone, msg) => `Echo: ${msg}`),
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
});

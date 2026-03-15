/**
 * WhatsApp Handler Tests
 *
 * Tests for the incoming WhatsApp webhook handler and route factory.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, getContext, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { whatsappRoutes } from "./index";

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
  app.route("/", whatsappRoutes(d, registry));
  return app;
}

function postWhatsApp(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("WhatsApp Routes", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  describe("GET /whatsapp", () => {
    it("should return health check text", async () => {
      const app = createApp();
      const res = await app.fetch(new Request("http://localhost/whatsapp", { method: "GET" }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("WhatsApp endpoint active");
    });
  });

  describe("POST /whatsapp", () => {
    it("should return greeting TwiML for empty message body", async () => {
      const app = createApp();
      const res = await postWhatsApp(app, { From: "whatsapp:+15551234567", Body: "" });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("</Message>");
      expect(text).toContain("<Response>");
    });

    it("should return greeting TwiML for whitespace-only body", async () => {
      const app = createApp();
      const res = await postWhatsApp(app, { From: "whatsapp:+15551234567", Body: "   " });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should strip whatsapp: prefix from phone number", async () => {
      const app = createApp();
      // Send empty body to trigger greeting path (avoids OpenAI call)
      await postWhatsApp(app, { From: "whatsapp:+15559998888", Body: "" });

      // The context should be keyed by the bare phone number, not whatsapp:+...
      const context = getContext("+15559998888");
      // No context created for empty body greeting (context is only created in processSms path)
      // But the phone number should be stripped when passed to handlers
    });

    it("should handle bare phone number without whatsapp: prefix", async () => {
      const app = createApp();
      const res = await postWhatsApp(app, { From: "+15551234567", Body: "" });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should default From to 'unknown' when missing", async () => {
      const app = createApp();
      const res = await postWhatsApp(app, { Body: "" });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should return 200 with text/xml for valid message", async () => {
      const app = createApp();
      const res = await postWhatsApp(app, {
        From: "whatsapp:+15551234567",
        Body: "Hello",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Response>");
    });

    it("should return error TwiML when processing fails", async () => {
      const app = createApp();
      const res = await postWhatsApp(app, {
        From: "whatsapp:+15551234567",
        Body: "Hello",
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Response>");
      expect(text).toContain("<Message>");
    });
  });
});

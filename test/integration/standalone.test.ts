/**
 * Integration Test: Standalone Server
 *
 * Tests the standalone server mode (no chatter dependency).
 * Requires OPENAI_API_KEY to be set for processing pipeline tests,
 * but basic route tests work without it.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../src/core/context";
import { FlowRegistry } from "../../src/flows/registry";
import { callRoutes } from "../../src/routes/call";
import { smsRoutes } from "../../src/routes/sms";
import { whatsappRoutes } from "../../src/routes/whatsapp";
import type { TalkerDependencies } from "../../src/types";

// Skip tests if env vars not set
const hasOpenAI = !!process.env.OPENAI_API_KEY;

function createTestDeps(
  chatFn?: (phone: string, msg: string) => Promise<string>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      transferNumber: "+441234567890",
      chatFn: chatFn || (async (_phone, msg) => `Echo: ${msg}`),
    },
    openaiApiKey: process.env.OPENAI_API_KEY || "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

describe("Standalone Server", () => {
  afterAll(() => {
    clearAllContexts();
    stopCleanup();
  });

  describe("Route mounting", () => {
    it("should mount call, sms, and whatsapp routes on a Hono app", async () => {
      const deps = createTestDeps();
      const registry = new FlowRegistry("");
      const app = new Hono();

      app.route("/", callRoutes(deps, registry));
      app.route("/", smsRoutes(deps, registry));
      app.route("/", whatsappRoutes(deps, registry));

      // Verify routes exist by checking health endpoints
      const smsRes = await app.fetch(new Request("http://localhost/sms", { method: "GET" }));
      expect(smsRes.status).toBe(200);

      const waRes = await app.fetch(new Request("http://localhost/whatsapp", { method: "GET" }));
      expect(waRes.status).toBe(200);
      expect(await waRes.text()).toBe("WhatsApp endpoint active");
    });
  });

  describe("SMS endpoint", () => {
    it("should return greeting for empty SMS body", async () => {
      const deps = createTestDeps();
      const registry = new FlowRegistry("");
      const app = new Hono();
      app.route("/", smsRoutes(deps, registry));

      const form = new URLSearchParams({ From: "+15551234567", Body: "" });
      const req = new Request("http://localhost/sms", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("</Message>");
    });
  });

  (hasOpenAI ? describe : describe.skip)("SMS with OpenAI (requires OPENAI_API_KEY)", () => {
    it("should process an SMS message end-to-end", async () => {
      const deps = createTestDeps(async (_phone, msg) => `Test response for: ${msg}`);
      const registry = new FlowRegistry("");
      const app = new Hono();
      app.route("/", smsRoutes(deps, registry));

      const form = new URLSearchParams({
        From: "+15551234567",
        Body: "What time is it?",
      });
      const req = new Request("http://localhost/sms", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("<Response>");
    }, 30000);
  });

  describe("WhatsApp endpoint", () => {
    it("should return greeting for empty WhatsApp body", async () => {
      const deps = createTestDeps();
      const registry = new FlowRegistry("");
      const app = new Hono();
      app.route("/", whatsappRoutes(deps, registry));

      const form = new URLSearchParams({
        From: "whatsapp:+15551234567",
        Body: "",
      });
      const req = new Request("http://localhost/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("</Message>");
    });
  });

  (hasOpenAI ? describe : describe.skip)("WhatsApp with OpenAI (requires OPENAI_API_KEY)", () => {
    it("should process a WhatsApp message end-to-end", async () => {
      const deps = createTestDeps(async (_phone, msg) => `Test response for: ${msg}`);
      const registry = new FlowRegistry("");
      const app = new Hono();
      app.route("/", whatsappRoutes(deps, registry));

      const form = new URLSearchParams({
        From: "whatsapp:+15551234567",
        Body: "What are your hours?",
      });
      const req = new Request("http://localhost/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("<Response>");
    }, 30000);
  });

  describe("Call endpoints", () => {
    it("should return initial greeting TwiML on POST /call", async () => {
      const deps = createTestDeps();
      const registry = new FlowRegistry("");
      const app = new Hono();
      app.route("/", callRoutes(deps, registry));

      const form = new URLSearchParams({ From: "+15551234567" });
      const req = new Request("http://localhost/call", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Response>");
      expect(text).toContain("<Say");
      expect(text).toContain("<Gather");
      expect(text).toContain('input="speech"');
    });

    it("should handle call status completed", async () => {
      const deps = createTestDeps();
      const registry = new FlowRegistry("");
      const app = new Hono();
      app.route("/", callRoutes(deps, registry));

      const form = new URLSearchParams({
        From: "+15551234567",
        CallStatus: "completed",
      });
      const req = new Request("http://localhost/call/status", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });
  });
});

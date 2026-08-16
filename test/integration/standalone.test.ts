/**
 * Integration Test: Standalone Server
 *
 * Tests the standalone server mode (no chatter dependency).
 * Requires OPENAI_API_KEY to be set for processing pipeline tests,
 * but basic route tests work without it.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../src/core/context";
import { FlowRegistry } from "../../src/flows/registry";
import { resetRateLimitStore } from "../../src/middleware/rate-limit";
import { callRoutes } from "../../src/routes/call";
import { messagingRoutes } from "../../src/routes/messaging";
import { createStandaloneServer } from "../../src/standalone";
import type { TalkerDependencies } from "../../src/types";

// Skip tests if env vars not set
const hasOpenAI = !!process.env.OPENAI_API_KEY;

function createTestDeps(
  chatFn?: (phone: string, msg: string) => Promise<string>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      // Unsigned test traffic: no Twilio auth token in these fixtures.
      allowUnsignedWebhooks: true,
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
    resetRateLimitStore();
    stopCleanup();
  });

  describe("Route mounting", () => {
    it("should mount call, sms, and whatsapp routes on a Hono app", async () => {
      const deps = createTestDeps();
      const registry = new FlowRegistry("");
      const app = new Hono();

      app.route("/", callRoutes(deps, registry));
      app.route("/", messagingRoutes(deps, registry, "sms"));
      app.route("/", messagingRoutes(deps, registry, "whatsapp"));

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
      app.route("/", messagingRoutes(deps, registry, "sms"));

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
      app.route("/", messagingRoutes(deps, registry, "sms"));

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
      app.route("/", messagingRoutes(deps, registry, "whatsapp"));

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
      app.route("/", messagingRoutes(deps, registry, "whatsapp"));

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

  describe("createStandaloneServer with flowsDir", () => {
    it("constructs an OpenAI client and loads flows without making a network call", async () => {
      const flowsDir = mkdtempSync(join(tmpdir(), "talker-standalone-flows-"));
      const flowDir = join(flowsDir, "greet");
      mkdirSync(flowDir);
      writeFileSync(
        join(flowDir, "flow.json"),
        JSON.stringify({
          id: "greet",
          name: "Greet",
          description: "test",
          triggerKeywords: ["hello"],
          schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        }),
      );
      writeFileSync(
        join(flowDir, "handler.ts"),
        "export async function execute(params) { return { success: true, say: 'hi' }; }",
      );
      writeFileSync(join(flowDir, "instructions.md"), "Extract the name.");

      try {
        const app = await createStandaloneServer({
          openaiApiKey: "test-key",
          allowUnsignedWebhooks: true,
          flowsDir,
        });
        expect(app).toBeDefined();
      } finally {
        rmSync(flowsDir, { recursive: true, force: true });
      }
    });

    it("refuses to start without a Twilio auth token", async () => {
      await expect(createStandaloneServer({ openaiApiKey: "test-key" })).rejects.toThrow(
        "Twilio auth token missing",
      );
    });

    it("starts when a Twilio auth token is configured", async () => {
      const app = await createStandaloneServer({
        openaiApiKey: "test-key",
        twilio: { authToken: "test-auth-token" },
      });

      // Signature validation is live: unsigned webhook traffic is refused
      const res = await app.fetch(
        new Request("http://localhost/sms", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: "+15551234567", Body: "hi" }).toString(),
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("CORS", () => {
    it("enables CORS by default", async () => {
      const app = await createStandaloneServer({
        openaiApiKey: "test-key",
        twilio: { authToken: "test-auth-token" },
      });

      const res = await app.fetch(
        new Request("http://localhost/healthz", {
          headers: { Origin: "https://example.com" },
        }),
      );
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("stays disabled when cors: false is configured", async () => {
      const app = await createStandaloneServer({
        openaiApiKey: "test-key",
        twilio: { authToken: "test-auth-token" },
        cors: false,
      });

      const res = await app.fetch(
        new Request("http://localhost/healthz", {
          headers: { Origin: "https://example.com" },
        }),
      );
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});

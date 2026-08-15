/**
 * Integration Test: Chatter Plugin Mode
 *
 * Tests the createTelephonyRoutes function.
 * These tests require @diegoaltoworks/chatter to be installed.
 *
 * Full end-to-end tests (with OpenAI) only run if OPENAI_API_KEY is set.
 */

import { afterAll, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../src/core/context";
import { computeTwilioSignature } from "../../src/middleware/twilio-signature";
import { createTelephonyRoutes } from "../../src/plugin";
import type { TalkerConfig } from "../../src/types";

function createMockChatterDeps(): ServerDependencies {
  return {
    client: {} as ServerDependencies["client"],
    store: {
      query: async () => ["Mocked knowledge chunk"],
    } as unknown as ServerDependencies["store"],
    config: {
      bot: { name: "TestBot", personName: "Test Person", publicUrl: "", description: "" },
      openai: { apiKey: process.env.OPENAI_API_KEY || "test-key" },
      database: { url: "", authToken: "" },
    },
    prompts: {
      baseSystemRules: "You are a test bot.",
      publicPersona: "Be helpful.",
    } as unknown as ServerDependencies["prompts"],
  } as ServerDependencies;
}

describe("Plugin Mode", () => {
  afterAll(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("should mount telephony routes on a Hono app", async () => {
    const app = new Hono();
    const deps = createMockChatterDeps();
    const config: TalkerConfig = {
      allowUnsignedWebhooks: true,
      transferNumber: "+441234567890",
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
    };

    await createTelephonyRoutes(app, deps, config);

    // Verify SMS health endpoint is mounted
    const smsRes = await app.fetch(new Request("http://localhost/sms", { method: "GET" }));
    expect(smsRes.status).toBe(200);

    // Verify WhatsApp health endpoint is mounted
    const waRes = await app.fetch(new Request("http://localhost/whatsapp", { method: "GET" }));
    expect(waRes.status).toBe(200);
    expect(await waRes.text()).toBe("WhatsApp endpoint active");

    // Verify call endpoint is mounted
    const form = new URLSearchParams({ From: "+15551234567" });
    const callRes = await app.fetch(
      new Request("http://localhost/call", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
    );
    expect(callRes.status).toBe(200);
    const text = await callRes.text();
    expect(text).toContain("<Response>");
  });

  it("should support route prefix", async () => {
    const app = new Hono();
    const deps = createMockChatterDeps();
    const config: TalkerConfig = {
      allowUnsignedWebhooks: true,
      routePrefix: "/tel",
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
    };

    await createTelephonyRoutes(app, deps, config);

    // Should work with prefix
    const smsRes = await app.fetch(new Request("http://localhost/tel/sms", { method: "GET" }));
    expect(smsRes.status).toBe(200);

    // WhatsApp should also work with prefix
    const waRes = await app.fetch(new Request("http://localhost/tel/whatsapp", { method: "GET" }));
    expect(waRes.status).toBe(200);

    // Should NOT work without prefix
    const noPrefix = await app.fetch(new Request("http://localhost/sms", { method: "GET" }));
    expect(noPrefix.status).toBe(404);

    const noPrefixWa = await app.fetch(new Request("http://localhost/whatsapp", { method: "GET" }));
    expect(noPrefixWa.status).toBe(404);
  });

  it("should throw if no OpenAI key is available", async () => {
    const app = new Hono();
    const deps = createMockChatterDeps();
    // Override to remove the key
    (deps.config as { openai: { apiKey: string } }).openai.apiKey = "";
    const config: TalkerConfig = {};

    await expect(createTelephonyRoutes(app, deps, config)).rejects.toThrow("OpenAI API key");
  });

  it("should refuse to mount without a Twilio auth token", async () => {
    const app = new Hono();
    const deps = createMockChatterDeps();

    await expect(createTelephonyRoutes(app, deps, {})).rejects.toThrow("Twilio auth token missing");

    // Nothing was mounted
    const smsRes = await app.fetch(new Request("http://localhost/sms", { method: "GET" }));
    expect(smsRes.status).toBe(404);
  });

  it("should mount and validate signatures when a Twilio auth token is configured", async () => {
    const app = new Hono();
    const deps = createMockChatterDeps();
    const authToken = "test-auth-token";
    const publicUrl = "https://bot.example.com";
    const params = { From: "+15551234567" };

    await createTelephonyRoutes(app, deps, {
      twilio: { authToken },
      publicUrl,
      routePrefix: "/tel",
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
    });

    function postCall(path: string, signature?: string) {
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (signature) headers["x-twilio-signature"] = signature;
      return app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers,
          body: new URLSearchParams(params).toString(),
        }),
      );
    }

    const unsigned = await postCall("/tel/call");
    expect(unsigned.status).toBe(403);

    // A request signed for the public URL Twilio called reaches the handler —
    // the prefix and the query string are both part of what Twilio signed.
    const signature = computeTwilioSignature(
      authToken,
      `${publicUrl}/tel/call?tenant=acme`,
      params,
    );
    const signed = await postCall("/tel/call?tenant=acme", signature);
    expect(signed.status).toBe(200);
    expect(await signed.text()).toContain("<Response>");
  });
});

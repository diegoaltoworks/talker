/**
 * Fallback Handler Tests
 *
 * Tests for the shared fallback webhook handler.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../core/context";
import type { TalkerDependencies } from "../../types";
import { handleFallback } from "./handle-fallback";

function createTestDeps(): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {},
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function createApp(channel: "sms" | "whatsapp") {
  const deps = createTestDeps();
  const app = new Hono();
  app.post("/fallback", (c) => handleFallback(c, deps, channel));
  return app;
}

function postFallback(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/fallback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleFallback", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  describe("SMS fallback", () => {
    it("should return 200 with TwiML error message", async () => {
      const app = createApp("sms");
      const res = await postFallback(app, {
        From: "+15551234567",
        Body: "Hello",
        ErrorCode: "11200",
        ErrorUrl: "https://example.com/sms",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Response>");
      expect(text).toContain("<Message>");
    });

    it("should return 200 with empty fields", async () => {
      const app = createApp("sms");
      const res = await postFallback(app, {});

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });
  });

  describe("WhatsApp fallback", () => {
    it("should return 200 with TwiML error message", async () => {
      const app = createApp("whatsapp");
      const res = await postFallback(app, {
        From: "whatsapp:+15551234567",
        Body: "Hello",
        ErrorCode: "11200",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Response>");
      expect(text).toContain("<Message>");
    });

    it("should handle bare phone numbers without whatsapp: prefix", async () => {
      const app = createApp("whatsapp");
      const res = await postFallback(app, {
        From: "+15551234567",
        Body: "Hello",
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });
  });
});

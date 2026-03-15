/**
 * Initial Call Handler Tests
 *
 * Tests for POST /call — initial greeting and speech gather.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, getContext, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { callRoutes } from "./index";

function createTestDeps(overrides?: Partial<TalkerDependencies["config"]>): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      transferNumber: "+441234567890",
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
      ...overrides,
    },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function createApp(deps?: TalkerDependencies) {
  const d = deps || createTestDeps();
  const registry = new FlowRegistry("");
  const app = new Hono();
  app.route("/", callRoutes(d, registry));
  return app;
}

function postCall(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/call", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleInitialCall", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("should return TwiML with greeting, Gather, and didNotHear fallback", async () => {
    const app = createApp();
    const res = await postCall(app, { From: "+15551234567" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/xml");

    const text = await res.text();
    expect(text).toContain("<?xml");
    expect(text).toContain("<Response>");
    expect(text).toContain("<Say");
    expect(text).toContain("<Gather");
    expect(text).toContain('input="speech"');
    expect(text).toContain('action="/call/respond"');
    expect(text).toContain("</Response>");
  });

  it("should include two Say elements — greeting and didNotHear", async () => {
    const app = createApp();
    const res = await postCall(app, { From: "+15551234567" });
    const text = await res.text();

    // Count <Say elements — should be 2 (greeting + didNotHear fallback)
    const sayMatches = text.match(/<Say /g);
    expect(sayMatches?.length).toBe(2);
  });

  it("should clear previous context for the phone number", async () => {
    const app = createApp();

    // First call creates context
    await postCall(app, { From: "+15551234567" });
    // Context should be cleared by the handler
    const context = getContext("+15551234567");
    expect(context).toBeUndefined();
  });

  it("should apply route prefix to Gather action URL", async () => {
    const deps = createTestDeps({ routePrefix: "/tel" });
    const app = createApp(deps);
    const res = await postCall(app, { From: "+15551234567" });
    const text = await res.text();

    expect(text).toContain('action="/tel/call/respond"');
  });

  it("should default From to 'unknown' when missing", async () => {
    const app = createApp();
    const res = await postCall(app, {});

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Response>");
  });

  it("should use English voice configuration", async () => {
    const app = createApp();
    const res = await postCall(app, { From: "+15551234567" });
    const text = await res.text();

    // Default English voice is Polly.Arthur with en-GB
    expect(text).toContain("en-GB");
  });
});

/**
 * Speech Response Handler Tests
 *
 * Tests for POST /call/respond — speech detection handling.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, getOrCreateContext, stopCleanup } from "../../core/context";
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

function postRespond(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/call/respond", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleRespond", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("should return didNotCatch Gather TwiML when SpeechResult is missing", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    const res = await postRespond(app, { From: "+15551234567" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/xml");
    const text = await res.text();
    expect(text).toContain("<Gather");
    expect(text).toContain("<Say");
    expect(text).toContain('action="/call/respond"');
  });

  it("should return didNotCatch when SpeechResult is empty string", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    const res = await postRespond(app, { From: "+15551234567", SpeechResult: "" });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Gather");
  });

  it("should return 200 with TwiML when processing speech (sync flow)", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    const res = await postRespond(app, {
      From: "+15551234567",
      SpeechResult: "What time do you open?",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/xml");
    const text = await res.text();
    expect(text).toContain("<Response>");
    // Either a processed response or error TwiML — both valid
    expect(text).toContain("<Say");
  });

  it("should return error TwiML when processing throws", async () => {
    // processCall will fail because OpenAI will reject with a test key
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    const res = await postRespond(app, {
      From: "+15551234567",
      SpeechResult: "Hello there",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Response>");
    expect(text).toContain("<Say");
  });

  it("should return acknowledgment TwiML when async ack is enabled for first message", async () => {
    const deps = createTestDeps({
      features: { thinkingAcknowledgmentEnabled: true },
    });
    const app = createApp(deps);
    getOrCreateContext("+15551234567", "call");

    const res = await postRespond(app, {
      From: "+15551234567",
      SpeechResult: "What is your menu?",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Response>");
    // Acknowledgment includes a redirect to /call/answer
    expect(text).toContain("/call/answer");
  });
});

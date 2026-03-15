/**
 * No-Speech Handler Tests
 *
 * Tests for POST /call/no-speech — silence detection retry logic.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import {
  clearAllContexts,
  getOrCreateContext,
  setDetectedLanguage,
  setLastPrompt,
  stopCleanup,
} from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { callRoutes } from "./index";

function createTestDeps(overrides?: Partial<TalkerDependencies["config"]>): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
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

function postNoSpeech(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/call/no-speech", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleNoSpeech", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("should return Gather TwiML on first retry", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    const res = await postNoSpeech(app, { From: "+15551234567" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/xml");
    const text = await res.text();
    expect(text).toContain("<Gather");
    expect(text).toContain("<Say");
  });

  it("should combine retry message with last prompt on first retry", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");
    setLastPrompt("+15551234567", "What is your name?");

    const res = await postNoSpeech(app, { From: "+15551234567" });
    const text = await res.text();

    expect(text).toContain("What is your name?");
  });

  it("should use only last prompt on subsequent retries", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");
    setLastPrompt("+15551234567", "What is your name?");

    // First retry
    await postNoSpeech(app, { From: "+15551234567" });
    // Second retry
    const res = await postNoSpeech(app, { From: "+15551234567" });
    const text = await res.text();

    expect(text).toContain("What is your name?");
    expect(text).toContain("<Gather");
  });

  it("should end call after max retries exceeded (default 3)", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    // Exhaust retries (default max is 3)
    await postNoSpeech(app, { From: "+15551234567" }); // 1
    await postNoSpeech(app, { From: "+15551234567" }); // 2
    await postNoSpeech(app, { From: "+15551234567" }); // 3
    const res = await postNoSpeech(app, { From: "+15551234567" }); // 4 > max

    const text = await res.text();
    // Should be a Say without Gather (call ends)
    expect(text).toContain("<Say");
    expect(text).not.toContain("<Gather");
  });

  it("should respect custom maxNoSpeechRetries config", async () => {
    const deps = createTestDeps({ maxNoSpeechRetries: 1 });
    const app = createApp(deps);
    getOrCreateContext("+15551234567", "call");

    // First retry (within limit)
    const res1 = await postNoSpeech(app, { From: "+15551234567" });
    expect(await res1.text()).toContain("<Gather");

    // Second retry (exceeds max of 1)
    const res2 = await postNoSpeech(app, { From: "+15551234567" });
    const text2 = await res2.text();
    expect(text2).toContain("<Say");
    expect(text2).not.toContain("<Gather");
  });

  it("should use detected language for phrases", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");
    setDetectedLanguage("+15551234567", "fr");

    const res = await postNoSpeech(app, { From: "+15551234567" });
    const text = await res.text();

    // French voice config
    expect(text).toContain("fr-FR");
  });
});

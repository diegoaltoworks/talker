/**
 * Initial Call Handler Tests
 *
 * Tests for POST /call — initial greeting and speech gather.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import {
  addMessage,
  clearAllContexts,
  getContext,
  setActiveFlow,
  stopCleanup,
} from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import { resetRateLimitStore } from "../../middleware/rate-limit";
import type { MessageTapEvent, TalkerDependencies } from "../../types";
import { callRoutes } from "./index";

function createTestDeps(overrides?: Partial<TalkerDependencies["config"]>): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      // Unsigned test traffic: no Twilio auth token in these fixtures.
      allowUnsignedWebhooks: true,
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

describe("handleInitialCall", () => {
  afterEach(() => {
    clearAllContexts();
    resetRateLimitStore();
    stopCleanup();
  });

  it("should return TwiML with the greeting nested in Gather, and a no-speech redirect", async () => {
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
    // Say nested inside Gather (barge-in) so the caller can speak over the greeting.
    expect(text).toMatch(/<Gather[^>]*>\s*<Say/);
    // First-turn silence engages the same no-speech retry ladder as every other turn.
    expect(text).toContain('<Redirect method="POST">/call/no-speech</Redirect>');
  });

  it("should include exactly one Say element for the greeting", async () => {
    const app = createApp();
    const res = await postCall(app, { From: "+15551234567" });
    const text = await res.text();

    const sayMatches = text.match(/<Say /g);
    expect(sayMatches?.length).toBe(1);
  });

  it("should clear previous conversation state for the phone number", async () => {
    const app = createApp();

    // Seed state from an earlier call.
    addMessage("+15551234567", "user", "leftover from an earlier call");
    setActiveFlow("+15551234567", "some-flow");

    await postCall(app, { From: "+15551234567" });

    // gatherTwiml stores the greeting as lastPrompt for the no-speech ladder,
    // so a fresh context now exists — but carries none of the prior state.
    const context = getContext("+15551234567");
    expect(context?.messageHistory).toEqual([]);
    expect(context?.activeFlow).toBeNull();
    expect(context?.noSpeechRetries).toBe(0);
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

  it("escapes a host greeting containing XML special characters", async () => {
    // A bare "&" from greetingFn would make Twilio reject the document
    // (error 12100) and drop the call before the caller hears anything.
    const deps = createTestDeps({ greetingFn: async () => `Welcome to Ben & Jerry's <VIP>` });
    const app = createApp(deps);
    const res = await postCall(app, { From: "+15551234567" });
    const text = await res.text();

    expect(text).toContain("Welcome to Ben &amp; Jerry&apos;s &lt;VIP&gt;");
    expect(text).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
  });

  it("taps the greeting unescaped", async () => {
    const events: MessageTapEvent[] = [];
    const deps = createTestDeps({
      greetingFn: async () => "Ben & Jerry's",
      onMessage: (event) => void events.push(event),
    });
    const app = createApp(deps);

    await postCall(app, { From: "+15559990002", To: "+15559876543" });
    await Promise.resolve();
    await Promise.resolve();

    expect(events[0]?.body).toBe("Ben & Jerry's");
  });

  it("engages the no-speech retry ladder starting from the very first turn", async () => {
    // Before this fix, handleInitialCall never touched the context store, so
    // incrementNoSpeechRetries (context.ts) always returned 0 for a phone
    // number that had never spoken - first-turn silence had no retry ladder
    // to fall into and the call would dead-end.
    const app = createApp();
    const phoneNumber = "+15559990097";

    await postCall(app, { From: phoneNumber });

    for (let i = 0; i < 3; i++) {
      const res = await postNoSpeech(app, { From: phoneNumber });
      const text = await res.text();
      expect(text).toContain("<Gather");
    }

    // One more silence exceeds the default max (3) and ends the call.
    const finalRes = await postNoSpeech(app, { From: phoneNumber });
    const finalText = await finalRes.text();
    expect(finalText).not.toContain("<Gather");
    expect(finalText).toContain("<Say");
  });

  it("fires an outbound onMessage event for the greeting", async () => {
    const events: MessageTapEvent[] = [];
    const deps = createTestDeps({ onMessage: (event) => void events.push(event) });
    const app = createApp(deps);

    await postCall(app, { From: "+15559990001", To: "+15559876543" });
    await Promise.resolve();
    await Promise.resolve();

    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      direction: "outbound",
      channel: "call",
      from: "+15559876543",
      to: "+15559990001",
    });
  });
});

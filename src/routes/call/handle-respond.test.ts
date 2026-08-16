/**
 * Speech Response Handler Tests
 *
 * Tests for POST /call/respond — speech detection handling.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type { Client } from "@libsql/client";
import { Hono } from "hono";
import { clearAllContexts, getOrCreateContext, stopCleanup } from "../../core/context";
import { setDbClient } from "../../db/client";
import { FlowRegistry } from "../../flows/registry";
import { resetRateLimitStore } from "../../middleware/rate-limit";
import type { MessageTapEvent, TalkerDependencies } from "../../types";

// processIncoming/processOutgoing call OpenAI directly (not through chatFn) -
// mock it so these route tests never hit the network. Incoming echoes the
// message back unprocessed; outgoing passes the bot response through as-is,
// matching this pipeline's own error-fallback behavior. incomingOverride lets
// individual tests flip shouldTransfer/shouldEndCall without an LLM in the
// loop; reset it in afterEach so it can't leak between tests.
let incomingOverride: { shouldTransfer?: boolean; shouldEndCall?: boolean } = {};
const callOpenAI = mock(
  async (
    _deps: TalkerDependencies,
    _systemPrompt: string,
    userMessage: string,
    context: { phoneNumber: string; stage: "incoming" | "outgoing" },
  ) => {
    if (context.stage === "incoming") {
      return JSON.stringify({
        shouldTransfer: incomingOverride.shouldTransfer ?? false,
        shouldEndCall: incomingOverride.shouldEndCall ?? false,
        detectedLanguage: "en",
        processedMessage: userMessage,
      });
    }
    return userMessage;
  },
);
mock.module("../../core/processing/openai", () => ({ callOpenAI }));

// mock.module is process-global, not scoped to this file - another test
// file's mock.module("../../flows/manager", ...) call would otherwise
// silently outlive its own file and decide what "no active flow" means
// here. Pin it explicitly rather than relying on the real FlowRegistry("")
// resolving the same way regardless of load order.
const processFlow = mock(async () => ({
  isFlowActive: false,
  flowCompleted: false,
  response: "",
}));
mock.module("../../flows/manager", () => ({ processFlow }));

// Dynamic import so it resolves after the mock.module() calls above - a
// static import of ./index would be hoisted ahead of the mock registration.
const { callRoutes } = await import("./index");

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
    resetRateLimitStore();
    stopCleanup();
    incomingOverride = {};
    setDbClient(null);
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

  it("should deliver the chatFn response as spoken TwiML (sync flow)", async () => {
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
    // processIncoming primes the transcript with the current turn before
    // checking for prior history, so even a first message is wrapped in a
    // CONVERSATION HISTORY block - asserted here as one joined string so a
    // reply split across unrelated tags can't satisfy this by accident.
    expect(text).toContain(
      "Echo: CONVERSATION HISTORY:\nCustomer: What time do you open?\n\nCURRENT MESSAGE:\nWhat time do you open?",
    );
  });

  it("should return the error TwiML when chatFn throws", async () => {
    const deps = createTestDeps({
      chatFn: async () => {
        throw new Error("downstream failure");
      },
    });
    const app = createApp(deps);
    getOrCreateContext("+15551234567", "call");

    const res = await postRespond(app, {
      From: "+15551234567",
      SpeechResult: "Hello there",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Response>");
    expect(text).toContain("Sorry, I encountered an error processing your question.");
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

  it("clamps an oversized SpeechResult to maxInputLength before processing", async () => {
    const events: MessageTapEvent[] = [];
    const deps = createTestDeps({
      maxInputLength: 20,
      onMessage: (event) => void events.push(event),
    });
    const app = createApp(deps);
    getOrCreateContext("+15559990005", "call");

    await postRespond(app, {
      From: "+15559990005",
      SpeechResult: "a".repeat(200),
    });
    await Promise.resolve();

    const inbound = events.find((e) => e.direction === "inbound");
    expect(inbound?.body.length).toBe(20);
    expect(inbound?.body).toBe("a".repeat(20));
  });

  describe("onMessage tap", () => {
    it("fires an inbound event for recognized speech and an outbound event for the reply", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps({ onMessage: (event) => void events.push(event) });
      const app = createApp(deps);
      getOrCreateContext("+15559990002", "call");

      await postRespond(app, {
        From: "+15559990002",
        To: "+15559876543",
        SpeechResult: "What time do you open?",
      });
      await Promise.resolve();
      await Promise.resolve();

      const inbound = events.filter((e) => e.direction === "inbound");
      const outbound = events.filter((e) => e.direction === "outbound");
      expect(inbound.length).toBe(1);
      expect(inbound[0]).toMatchObject({
        channel: "call",
        from: "+15559990002",
        to: "+15559876543",
        body: "What time do you open?",
      });
      expect(outbound.length).toBeGreaterThanOrEqual(1);
      expect(outbound[0]).toMatchObject({
        channel: "call",
        from: "+15559876543",
        to: "+15559990002",
      });
    });

    it("fires an outbound event for the didNotCatch prompt when SpeechResult is missing", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps({ onMessage: (event) => void events.push(event) });
      const app = createApp(deps);
      getOrCreateContext("+15559990003", "call");

      await postRespond(app, { From: "+15559990003", To: "+15559876543" });
      await Promise.resolve();

      expect(events.length).toBe(1);
      expect(events[0].direction).toBe("outbound");
    });

    it("does not throw and still replies when onMessage throws", async () => {
      const deps = createTestDeps({
        onMessage: () => {
          throw new Error("tap handler exploded");
        },
      });
      const app = createApp(deps);
      getOrCreateContext("+15559990004", "call");

      const res = await postRespond(app, {
        From: "+15559990004",
        To: "+15559876543",
        SpeechResult: "Hello there",
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Response>");
    });
  });

  describe("session persistence on transfer", () => {
    // handleRespond calls persistSession unconditionally after processCall
    // resolves, on top of whatever processCall already persisted internally
    // for a terminal branch (transfer/end-call). Regression coverage for
    // that interaction has to go through the actual route, not just
    // processCall or the persist helpers in isolation - see db/persist.test.ts
    // for the ordering contract this depends on.
    it("keeps the redirected reason - handleRespond's own persistSession call must not clobber it back to ended", async () => {
      incomingOverride = { shouldTransfer: true };
      const writes: Array<{ reason: unknown; transferReason: unknown }> = [];
      setDbClient({
        execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
          if (sql.includes("talker_sessions")) {
            writes.push({ reason: args[3], transferReason: args[8] });
          }
          return {};
        },
        close: () => {},
      } as unknown as Client);

      const app = createApp();
      getOrCreateContext("+15559990099", "call");

      await postRespond(app, {
        From: "+15559990099",
        SpeechResult: "put me through to a person",
      });
      // handleRespond's post-processCall persistSession call is fire-and-forget.
      await new Promise((r) => setTimeout(r, 20));

      expect(writes.length).toBeGreaterThan(0);
      const last = writes[writes.length - 1];
      expect(last.reason).toBe("redirected");
      // processIncoming wraps the raw speech in a CONVERSATION HISTORY block
      // even on the first turn - assert the substance survived, not the
      // exact wrapper text.
      expect(last.transferReason).toContain("put me through to a person");
    });
  });
});

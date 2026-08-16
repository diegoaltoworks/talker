/**
 * Messaging Handler Tests
 *
 * Tests for the incoming SMS/WhatsApp webhook handler and route factory.
 * Parameterized over both channels so behavior stays pinned together; only
 * the `whatsapp:`-prefix stripping is WhatsApp-specific.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import { resetRateLimitStore } from "../../middleware/rate-limit";
import type { MessageTapEvent, TalkerDependencies } from "../../types";
import type { MessagingChannel } from "./processor";

// processIncoming/processOutgoing call OpenAI directly (not through chatFn) -
// mock it so these route tests never hit the network. Incoming echoes the
// message back unprocessed; outgoing passes the bot response through as-is,
// matching this pipeline's own error-fallback behavior.
const callOpenAI = mock(
  async (
    _deps: TalkerDependencies,
    _systemPrompt: string,
    userMessage: string,
    context: { phoneNumber: string; stage: "incoming" | "outgoing" },
  ) => {
    if (context.stage === "incoming") {
      return JSON.stringify({
        shouldTransfer: false,
        shouldEndCall: false,
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
const { messagingRoutes } = await import("./index");

function createTestDeps(
  chatFn?: (phone: string, msg: string) => Promise<string>,
  configOverrides?: Partial<TalkerDependencies["config"]>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      // Unsigned test traffic: no Twilio auth token in these fixtures.
      allowUnsignedWebhooks: true,
      transferNumber: "+441234567890",
      chatFn: chatFn || (async (_phone, msg) => `Echo: ${msg}`),
      ...configOverrides,
    },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function createApp(channel: MessagingChannel, deps?: TalkerDependencies) {
  const d = deps || createTestDeps();
  const registry = new FlowRegistry("");
  const app = new Hono();
  app.route("/", messagingRoutes(d, registry, channel));
  return app;
}

function postMessage(
  channel: MessagingChannel,
  app: ReturnType<typeof createApp>,
  fields: Record<string, string>,
) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request(`http://localhost/${channel}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

async function flushTapQueue() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const CHANNELS: Array<{ channel: MessagingChannel; label: string; from: (n: string) => string }> = [
  { channel: "sms", label: "SMS", from: (n) => n },
  { channel: "whatsapp", label: "WhatsApp", from: (n) => `whatsapp:${n}` },
];

describe.each(CHANNELS)("$label Routes", ({ channel, label, from }) => {
  afterEach(() => {
    clearAllContexts();
    resetRateLimitStore();
    stopCleanup();
  });

  describe(`GET /${channel}`, () => {
    it("should return health check text", async () => {
      const app = createApp(channel);
      const res = await app.fetch(new Request(`http://localhost/${channel}`, { method: "GET" }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`${label} endpoint active`);
    });
  });

  describe(`POST /${channel}`, () => {
    it("should return greeting TwiML for empty message body", async () => {
      const app = createApp(channel);
      const res = await postMessage(channel, app, { From: from("+15551234567"), Body: "" });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Message>");
      expect(text).toContain("</Message>");
      expect(text).toContain("<Response>");
    });

    it("should return greeting TwiML for whitespace-only body", async () => {
      const app = createApp(channel);
      const res = await postMessage(channel, app, { From: from("+15551234567"), Body: "   " });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should default From to 'unknown' when missing", async () => {
      const app = createApp(channel);
      const res = await postMessage(channel, app, { Body: "" });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });

    it("should return 200 with text/xml content type for valid message", async () => {
      const app = createApp(channel);
      const res = await postMessage(channel, app, { From: from("+15551234567"), Body: "Hello" });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/xml");
      const text = await res.text();
      expect(text).toContain("<Response>");
    });

    it("clamps an oversized Body to maxInputLength before processing", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps(undefined, {
        maxInputLength: 20,
        onMessage: (event) => void events.push(event),
      });
      const app = createApp(channel, deps);

      await postMessage(channel, app, {
        From: from("+15559990020"),
        Body: "b".repeat(200),
      });
      await flushTapQueue();

      const inbound = events.find((e) => e.direction === "inbound");
      expect(inbound?.body.length).toBe(20);
      expect(inbound?.body).toBe("b".repeat(20));
    });

    it("should return the chat error TwiML when chatFn throws", async () => {
      const deps = createTestDeps(async () => {
        throw new Error("downstream failure");
      });
      const app = createApp(channel, deps);
      const res = await postMessage(channel, app, { From: from("+15551234567"), Body: "Hello" });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Sorry, I encountered an error processing your question.");
    });
  });

  describe("onMessage tap", () => {
    it("fires inbound and outbound events for a normal exchange", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps(async (_phone, msg) => `Echo: ${msg}`, {
        onMessage: (event) => void events.push(event),
      });
      const app = createApp(channel, deps);

      await postMessage(channel, app, {
        From: from("+15559990010"),
        To: from("+15559876543"),
        Body: "Hello",
      });
      await flushTapQueue();

      expect(events.length).toBe(2);
      expect(events[0]).toMatchObject({
        direction: "inbound",
        channel,
        from: "+15559990010",
        to: "+15559876543",
        body: "Hello",
      });
      expect(events[1]).toMatchObject({
        direction: "outbound",
        channel,
        from: "+15559876543",
        to: "+15559990010",
      });
    });

    it("fires inbound and outbound events for the empty-body greeting path", async () => {
      const events: MessageTapEvent[] = [];
      const deps = createTestDeps(undefined, { onMessage: (event) => void events.push(event) });
      const app = createApp(channel, deps);

      await postMessage(channel, app, {
        From: from("+15559990011"),
        To: from("+15559876543"),
        Body: "",
      });
      await flushTapQueue();

      expect(events.length).toBe(2);
      expect(events[0].direction).toBe("inbound");
      expect(events[1].direction).toBe("outbound");
      expect(events[1].body.length).toBeGreaterThan(0);
    });

    it("does not throw and still replies when onMessage throws", async () => {
      const deps = createTestDeps(async (_phone, msg) => `Echo: ${msg}`, {
        onMessage: () => {
          throw new Error("tap handler exploded");
        },
      });
      const app = createApp(channel, deps);

      const res = await postMessage(channel, app, {
        From: from("+15559990012"),
        To: from("+15559876543"),
        Body: "Hello",
      });
      await flushTapQueue();

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<Message>");
    });
  });
});

describe("WhatsApp-specific From handling", () => {
  afterEach(() => {
    clearAllContexts();
    resetRateLimitStore();
    stopCleanup();
  });

  it("strips the whatsapp: prefix from the phone number", async () => {
    const events: MessageTapEvent[] = [];
    const deps = createTestDeps(undefined, { onMessage: (event) => void events.push(event) });
    const app = createApp("whatsapp", deps);

    await postMessage("whatsapp", app, { From: "whatsapp:+15559998888", Body: "" });
    await flushTapQueue();

    expect(events[0].from).toBe("+15559998888");
  });

  it("handles a bare phone number without the whatsapp: prefix", async () => {
    const app = createApp("whatsapp");
    const res = await postMessage("whatsapp", app, { From: "+15551234567", Body: "" });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Message>");
  });
});

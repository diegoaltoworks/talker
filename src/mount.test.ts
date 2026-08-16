import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  clearAllConversations,
  getConversation,
  getOrCreateConversation,
} from "./core/chatbot/conversations";
import {
  type ContextStore,
  configureContextStore,
  createInMemoryContextStore,
  getContext,
  getOrCreateContext,
  stopCleanup,
} from "./core/context";
import { FlowRegistry } from "./flows/registry";
import { mountTelephony } from "./mount";
import { getPending, setPending } from "./routes/call/pending";
import type { TalkerConfig, TalkerDependencies } from "./types";

function makeDeps(config: TalkerConfig = {}): TalkerDependencies {
  return { config, openaiApiKey: "test-key", openaiModel: "gpt-4o-mini" };
}

describe("mountTelephony", () => {
  afterEach(() => {
    stopCleanup();
    configureContextStore(createInMemoryContextStore());
    clearAllConversations();
  });

  it("mounts messaging routes at the root when routePrefix is unset", async () => {
    const app = new Hono();
    mountTelephony(app, makeDeps(), new FlowRegistry(""));

    const res = await app.request("/sms");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("SMS endpoint active");
  });

  it("mounts messaging routes under a configured routePrefix", async () => {
    const app = new Hono();
    mountTelephony(app, makeDeps({ routePrefix: "/api" }), new FlowRegistry(""));

    const res = await app.request("/api/whatsapp");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("WhatsApp endpoint active");
  });

  it("does not mount messaging routes at the root when routePrefix is set", async () => {
    const app = new Hono();
    mountTelephony(app, makeDeps({ routePrefix: "/api" }), new FlowRegistry(""));

    const res = await app.request("/sms");

    expect(res.status).toBe(404);
  });

  it("applies an explicitly-injected config.contextStore", () => {
    const app = new Hono();
    const backing = new Map<string, ReturnType<typeof getOrCreateContext>>();
    const fakeStore: ContextStore = {
      get: (phoneNumber) => backing.get(phoneNumber),
      set: (phoneNumber, context) => backing.set(phoneNumber, context),
      delete: (phoneNumber) => backing.delete(phoneNumber),
      clear: () => backing.clear(),
      entries: () => backing.entries(),
    };

    mountTelephony(app, makeDeps({ contextStore: fakeStore }), new FlowRegistry(""));

    const ctx = getOrCreateContext("+1234567890");

    expect(backing.get("+1234567890")).toBe(ctx);
    expect(getContext("+1234567890")).toBe(ctx);
  });

  it("leaves the shared default ContextStore in place when contextStore is unconfigured", () => {
    const app = new Hono();
    // A context created by an earlier mount (or the module default) must
    // still be reachable after this one - mounting twice in one process
    // (two chatter instances, a test that doesn't reset) must not silently
    // orphan state that was never explicitly configured away.
    getOrCreateContext("+1908887777");

    mountTelephony(app, makeDeps(), new FlowRegistry(""));

    expect(getContext("+1908887777")).toBeDefined();
  });

  it("sweeps both pending queries and chatbot conversations from the shared cleanup tick", async () => {
    const app = new Hono();
    setPending("+15550001111", {
      speechResult: "hello",
      promise: Promise.resolve({ twiml: "" }),
      resolve: () => {},
    });
    const conversation = getOrCreateConversation("+15550002222");
    conversation.lastActivityAt = Date.now() - 10_000;

    mountTelephony(
      app,
      makeDeps({ contextTtlMs: 1000, cleanupIntervalMs: 5, pendingQueryTtlMs: 0 }),
      new FlowRegistry(""),
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(getPending("+15550001111")).toBeUndefined();
    expect(getConversation("+15550002222")).toBeUndefined();
  });
});

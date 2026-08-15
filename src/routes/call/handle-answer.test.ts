/**
 * Answer Handler Tests
 *
 * Tests for POST /call/answer — async acknowledgment resolution.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { MessageTapEvent, TalkerDependencies } from "../../types";
import { callRoutes } from "./index";
import { deletePending, getPending, setPending } from "./pending";

function createTestDeps(
  configOverrides?: Partial<TalkerDependencies["config"]>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      // Unsigned test traffic: no Twilio auth token in these fixtures.
      allowUnsignedWebhooks: true,
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
      ...configOverrides,
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

function postAnswer(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/call/answer", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleAnswer", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
    deletePending("+15551234567");
  });

  it("should return lostQuestion Gather TwiML when no pending query exists", async () => {
    const app = createApp();
    const res = await postAnswer(app, { From: "+15551234567" });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Gather");
    expect(text).toContain("<Say");
    // Should prompt user to repeat their question
    expect(text).toContain("<Response>");
  });

  it("should return resolved TwiML when pending query resolves", async () => {
    const app = createApp();

    // Set up a pending query that resolves immediately
    let resolveQuery: ((value: { twiml: string }) => void) | undefined;
    const promise = new Promise<{ twiml: string }>((resolve) => {
      resolveQuery = resolve;
    });

    setPending("+15551234567", {
      speechResult: "test",
      promise,
      resolve: resolveQuery as (value: { twiml: string }) => void,
    });

    // Resolve before the handler reads it
    (resolveQuery as (value: { twiml: string }) => void)({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Test answer</Say></Response>`,
    });

    const res = await postAnswer(app, { From: "+15551234567" });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Test answer");
  });

  it("should return timeout TwiML when the pending query itself rejects", async () => {
    const app = createApp();

    const promise = new Promise<{ twiml: string }>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Processing timeout")), 10);
    });

    setPending("+15551234567", {
      speechResult: "test",
      promise,
      resolve: () => {},
    });

    const res = await postAnswer(app, { From: "+15551234567" });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Sorry, I took too long to respond");
    expect(getPending("+15551234567")).toBeUndefined();
  });

  it("should honor a configured callAnswerBudgetMs and speak the timeout phrase before the pending query resolves", async () => {
    const deps = createTestDeps({ callAnswerBudgetMs: 20 });
    const app = createApp(deps);
    const phoneNumber = "+15559990098";

    const promise = new Promise<{ twiml: string }>((resolve) => {
      setTimeout(
        () => resolve({ twiml: `<?xml version="1.0"?><Response><Say>Late</Say></Response>` }),
        200,
      );
    });

    setPending(phoneNumber, { speechResult: "test", promise, resolve: () => {} });

    const res = await postAnswer(app, { From: phoneNumber });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Sorry, I took too long to respond");
    expect(text).not.toContain("Late");
    // The finally block deletes the entry regardless of which race branch won.
    expect(getPending(phoneNumber)).toBeUndefined();
  });

  it("fires an outbound onMessage event for the lostQuestion prompt", async () => {
    const events: MessageTapEvent[] = [];
    const deps = createTestDeps({ onMessage: (event) => void events.push(event) });
    const app = createApp(deps);

    await postAnswer(app, { From: "+15559990006", To: "+15559876543" });
    await Promise.resolve();

    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      direction: "outbound",
      channel: "call",
      from: "+15559876543",
      to: "+15559990006",
    });
  });
});

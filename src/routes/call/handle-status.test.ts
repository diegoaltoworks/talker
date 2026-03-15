/**
 * Call Status Handler Tests
 *
 * Tests for POST /call/status — call state change webhook.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { clearAllContexts, getContext, getOrCreateContext, stopCleanup } from "../../core/context";
import { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { callRoutes } from "./index";

function createTestDeps(): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
    },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function createApp() {
  const deps = createTestDeps();
  const registry = new FlowRegistry("");
  const app = new Hono();
  app.route("/", callRoutes(deps, registry));
  return app;
}

function postStatus(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return app.fetch(
    new Request("http://localhost/call/status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
}

describe("handleStatus", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("should return 200 with empty body for completed status", async () => {
    const app = createApp();
    // Pre-create context so there's something to clear
    getOrCreateContext("+15551234567", "call");

    const res = await postStatus(app, {
      From: "+15551234567",
      CallStatus: "completed",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("should clear context when call completes", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");
    expect(getContext("+15551234567")).toBeDefined();

    await postStatus(app, {
      From: "+15551234567",
      CallStatus: "completed",
    });

    expect(getContext("+15551234567")).toBeUndefined();
  });

  it("should return 200 for non-completed status without clearing context", async () => {
    const app = createApp();
    getOrCreateContext("+15551234567", "call");

    const res = await postStatus(app, {
      From: "+15551234567",
      CallStatus: "ringing",
    });

    expect(res.status).toBe(200);
    // Context should NOT be cleared for non-completed statuses
    expect(getContext("+15551234567")).toBeDefined();
  });

  it("should handle in-progress status", async () => {
    const app = createApp();
    const res = await postStatus(app, {
      From: "+15551234567",
      CallStatus: "in-progress",
    });

    expect(res.status).toBe(200);
  });

  it("should handle missing CallStatus gracefully", async () => {
    const app = createApp();
    const res = await postStatus(app, {
      From: "+15551234567",
    });

    expect(res.status).toBe(200);
  });

  it("should handle missing From field", async () => {
    const app = createApp();
    const res = await postStatus(app, {
      CallStatus: "completed",
    });

    expect(res.status).toBe(200);
  });
});

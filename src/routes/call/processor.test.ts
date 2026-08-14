/**
 * Call Processor Tests
 *
 * Covers flow-cancellation and flow-error delivery: processCall must deliver
 * FlowResult.response (via Gather TwiML) for a cancelled or errored flow
 * instead of falling through to a full chatbot turn.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type { FlowResult, TalkerDependencies } from "../../types";

let flowResultToReturn: FlowResult = { isFlowActive: false, response: "", flowCompleted: false };
const processFlow = mock(async () => flowResultToReturn);
mock.module("../../flows/manager", () => ({ processFlow }));

// Dynamic import so it resolves after the mock.module() call above - a static
// import of ./processor would be hoisted ahead of the mock registration.
const { clearAllContexts, stopCleanup } = await import("../../core/context");
const { FlowRegistry } = await import("../../flows/registry");
const { processCall } = await import("./processor");

function makeDeps(configOverrides: Partial<TalkerDependencies["config"]> = {}): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: { ...configOverrides },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

describe("processCall flow cancellation and error delivery", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("delivers the cancellation response instead of falling through to the chatbot", async () => {
    flowResultToReturn = {
      isFlowActive: false,
      flowCompleted: false,
      response: "CANCELLED_TEXT",
      cancelled: true,
    };
    const deps = makeDeps();
    const registry = new FlowRegistry("");

    const twiml = await processCall(deps, registry, "+15551234570", "cancel", "+15559876543");

    expect(twiml).toContain("CANCELLED_TEXT");
    expect(twiml).toContain("<Gather");
  });

  it("delivers the error response instead of falling through to the chatbot", async () => {
    flowResultToReturn = {
      isFlowActive: false,
      flowCompleted: false,
      response: "ERROR_TEXT",
      error: true,
    };
    const deps = makeDeps();
    const registry = new FlowRegistry("");

    const twiml = await processCall(deps, registry, "+15551234571", "hello", "+15559876543");

    expect(twiml).toContain("ERROR_TEXT");
    expect(twiml).toContain("<Gather");
  });
});

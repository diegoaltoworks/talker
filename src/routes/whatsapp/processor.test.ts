/**
 * WhatsApp Processor Tests
 *
 * Covers channel-specific flow content delivery: processWhatsApp must prefer
 * FlowResult.whatsappContent over the generic `response` when the flow
 * handler set it, and fall back to `response` otherwise.
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
const { processWhatsApp } = await import("./processor");

function makeDeps(configOverrides: Partial<TalkerDependencies["config"]> = {}): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: { ...configOverrides },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

describe("processWhatsApp channel-specific flow content", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("delivers whatsappContent over response when the flow handler set it", async () => {
    flowResultToReturn = {
      isFlowActive: false,
      flowCompleted: true,
      response: "SAY_TEXT",
      smsContent: "SMS_TEXT",
      whatsappContent: "WHATSAPP_TEXT",
      flowSuccess: true,
    };
    const events: string[] = [];
    const deps = makeDeps({ onMessage: (event) => void events.push(event.body) });
    const registry = new FlowRegistry("");

    const twiml = await processWhatsApp(deps, registry, "+15551234567", "hi", "+15559876543");

    expect(twiml).toContain("WHATSAPP_TEXT");
    expect(twiml).not.toContain("SAY_TEXT");
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toContain("WHATSAPP_TEXT");
  });

  it("falls back to response when the flow handler omits whatsappContent", async () => {
    flowResultToReturn = {
      isFlowActive: false,
      flowCompleted: true,
      response: "SAY_ONLY",
      flowSuccess: true,
    };
    const deps = makeDeps();
    const registry = new FlowRegistry("");

    const twiml = await processWhatsApp(deps, registry, "+15551234568", "hi", "+15559876543");

    expect(twiml).toContain("SAY_ONLY");
  });

  it("discards whatsappContent for a failed flow and sends the generic error phrase instead", async () => {
    flowResultToReturn = {
      isFlowActive: false,
      flowCompleted: true,
      response: "SAY_TEXT",
      smsContent: "SMS_TEXT",
      whatsappContent: "WHATSAPP_TEXT",
      flowSuccess: false,
    };
    const deps = makeDeps();
    const registry = new FlowRegistry("");

    const twiml = await processWhatsApp(deps, registry, "+15551234569", "hi", "+15559876543");

    expect(twiml).not.toContain("WHATSAPP_TEXT");
    expect(twiml).not.toContain("SAY_TEXT");
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

    const twiml = await processWhatsApp(deps, registry, "+15551234570", "cancel", "+15559876543");

    expect(twiml).toContain("CANCELLED_TEXT");
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

    const twiml = await processWhatsApp(deps, registry, "+15551234571", "hi", "+15559876543");

    expect(twiml).toContain("ERROR_TEXT");
  });
});

/**
 * Messaging Processor Tests
 *
 * Covers channel-specific flow content delivery: processMessage must prefer
 * FlowResult.smsContent/whatsappContent over the generic `response` when the
 * flow handler set it, and fall back to `response` otherwise. Parameterized
 * over both channels so the SMS and WhatsApp behavior stays pinned together.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type { FlowResult, TalkerDependencies } from "../../types";
import type { MessagingChannel } from "./processor";

let flowResultToReturn: FlowResult = { isFlowActive: false, response: "", flowCompleted: false };
const processFlow = mock(async () => flowResultToReturn);
mock.module("../../flows/manager", () => ({ processFlow }));

// Dynamic import so it resolves after the mock.module() call above - a static
// import of ./processor would be hoisted ahead of the mock registration.
const { clearAllContexts, stopCleanup } = await import("../../core/context");
const { FlowRegistry } = await import("../../flows/registry");
const { processMessage } = await import("./processor");

function makeDeps(configOverrides: Partial<TalkerDependencies["config"]> = {}): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: { ...configOverrides },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

const CHANNELS: Array<{
  channel: MessagingChannel;
  contentField: "smsContent" | "whatsappContent";
}> = [
  { channel: "sms", contentField: "smsContent" },
  { channel: "whatsapp", contentField: "whatsappContent" },
];

describe.each(CHANNELS)(
  "processMessage channel-specific flow content ($channel)",
  ({ channel, contentField }) => {
    afterEach(() => {
      clearAllContexts();
      stopCleanup();
    });

    it(`delivers ${contentField} over response when the flow handler set it`, async () => {
      flowResultToReturn = {
        isFlowActive: false,
        flowCompleted: true,
        response: "SAY_TEXT",
        smsContent: "SMS_TEXT",
        whatsappContent: "WHATSAPP_TEXT",
        flowSuccess: true,
      };
      const expectedContent = flowResultToReturn[contentField] as string;
      const events: string[] = [];
      const deps = makeDeps({ onMessage: (event) => void events.push(event.body) });
      const registry = new FlowRegistry("");

      const twiml = await processMessage(
        deps,
        registry,
        "+15551234567",
        "hi",
        "+15559876543",
        channel,
      );

      expect(twiml).toContain(expectedContent);
      expect(twiml).not.toContain("SAY_TEXT");
      await Promise.resolve();
      await Promise.resolve();
      expect(events).toContain(expectedContent);
    });

    it(`falls back to response when the flow handler omits ${contentField}`, async () => {
      flowResultToReturn = {
        isFlowActive: false,
        flowCompleted: true,
        response: "SAY_ONLY",
        flowSuccess: true,
      };
      const deps = makeDeps();
      const registry = new FlowRegistry("");

      const twiml = await processMessage(
        deps,
        registry,
        "+15551234568",
        "hi",
        "+15559876543",
        channel,
      );

      expect(twiml).toContain("SAY_ONLY");
    });

    it(`discards ${contentField} for a failed flow and sends the generic error phrase instead`, async () => {
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

      const twiml = await processMessage(
        deps,
        registry,
        "+15551234569",
        "hi",
        "+15559876543",
        channel,
      );

      expect(twiml).not.toContain("SMS_TEXT");
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

      const twiml = await processMessage(
        deps,
        registry,
        "+15551234570",
        "cancel",
        "+15559876543",
        channel,
      );

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

      const twiml = await processMessage(
        deps,
        registry,
        "+15551234571",
        "hi",
        "+15559876543",
        channel,
      );

      expect(twiml).toContain("ERROR_TEXT");
    });
  },
);

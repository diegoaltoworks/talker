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

// processIncoming calls OpenAI directly to classify shouldTransfer/shouldEndCall
// and clean up the transcript - mock it so these tests never hit the network,
// and so individual tests can flip those flags without an LLM in the loop.
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

// Dynamic import so it resolves after the mock.module() calls above - a static
// import of ./processor would be hoisted ahead of the mock registration.
const { clearAllContexts, getLastPrompt, stopCleanup } = await import("../../core/context");
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

describe("processCall XML escaping", () => {
  const UNSAFE = `Booking for Ben & Jerry's <VIP>`;
  const ESCAPED = "Booking for Ben &amp; Jerry&apos;s &lt;VIP&gt;";

  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  it("escapes a flow response exactly once", async () => {
    flowResultToReturn = { isFlowActive: true, flowCompleted: false, response: UNSAFE };
    const twiml = await processCall(
      makeDeps(),
      new FlowRegistry(""),
      "+15551234572",
      "book",
      "+15559876543",
    );

    expect(twiml).toContain(`>${ESCAPED}</Say>`);
    expect(twiml).not.toContain("&amp;amp;");
  });

  it("escapes the failed-flow transfer response", async () => {
    flowResultToReturn = {
      isFlowActive: false,
      flowCompleted: true,
      flowSuccess: false,
      response: UNSAFE,
    };
    const twiml = await processCall(
      makeDeps({ transferNumber: "+441234567890" }),
      new FlowRegistry(""),
      "+15551234573",
      "book",
      "+15559876543",
    );

    expect(twiml).toContain(`>${ESCAPED}</Say>`);
    expect(twiml).toContain("<Dial>+441234567890</Dial>");
  });

  it("taps and stores the response unescaped", async () => {
    // The tap is an observability seam: consumers must see the text the caller
    // hears, not XML entities.
    const bodies: string[] = [];
    flowResultToReturn = { isFlowActive: true, flowCompleted: false, response: UNSAFE };
    const phoneNumber = "+15551234574";

    await processCall(
      makeDeps({ onMessage: (event) => void bodies.push(event.body) }),
      new FlowRegistry(""),
      phoneNumber,
      "book",
      "+15559876543",
    );
    await Promise.resolve();

    expect(bodies).toContain(UNSAFE);
    expect(getLastPrompt(phoneNumber)).toBe(UNSAFE);
  });
});

describe("processCall transfer, end-call, and default chat branches", () => {
  afterEach(() => {
    incomingOverride = {};
    clearAllContexts();
    stopCleanup();
  });

  it("transfers to a human without consulting the flow engine when shouldTransfer is set", async () => {
    incomingOverride = { shouldTransfer: true };
    processFlow.mockClear();

    const twiml = await processCall(
      makeDeps({ transferNumber: "+441234567890" }),
      new FlowRegistry(""),
      "+15551234580",
      "let me talk to a person",
      "+15559876543",
    );

    expect(twiml).toContain("<Dial>+441234567890</Dial>");
    expect(twiml).toContain("Let me connect you with someone directly.");
    expect(processFlow).not.toHaveBeenCalled();
  });

  it("ends the call politely and clears context when shouldEndCall is set", async () => {
    incomingOverride = { shouldEndCall: true };
    processFlow.mockClear();
    const phoneNumber = "+15551234581";

    const twiml = await processCall(
      makeDeps(),
      new FlowRegistry(""),
      phoneNumber,
      "no that's all, goodbye",
      "+15559876543",
    );

    expect(twiml).toContain("<Hangup/>");
    expect(twiml).not.toContain("<Gather");
    expect(processFlow).not.toHaveBeenCalled();
    expect(getLastPrompt(phoneNumber)).toBeNull();
  });

  it("falls through to the chatbot and gathers again when no flow and no transfer/end-call intent apply", async () => {
    flowResultToReturn = { isFlowActive: false, flowCompleted: false, response: "" };

    const twiml = await processCall(
      makeDeps({ chatFn: async (_phone, msg) => `Echo: ${msg}` }),
      new FlowRegistry(""),
      "+15551234582",
      "what are your hours?",
      "+15559876543",
    );

    expect(twiml).toContain("<Gather");
    // processIncoming wraps even a first message in a CONVERSATION HISTORY
    // block - asserted as one joined string, not two independent toContain
    // calls that could each match unrelated parts of the TwiML.
    expect(twiml).toContain(
      "Echo: CONVERSATION HISTORY:\nCustomer: what are your hours?\n\nCURRENT MESSAGE:\nwhat are your hours?",
    );
  });
});

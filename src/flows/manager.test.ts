/**
 * Flow Manager Tests
 *
 * Covers processFlow wiring a handler's per-channel content (say/sms/whatsapp)
 * through to FlowResult.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  clearAllContexts,
  getActiveFlow,
  getOrCreateContext,
  setActiveFlow,
} from "../core/context";
import { getFlowPhrase } from "../core/phrases";
import type { FlowDefinition, FlowHandlerResult, LoadedFlow, TalkerDependencies } from "../types";
import { processFlow } from "./manager";
import type { FlowRegistry } from "./registry";

const definition: FlowDefinition = {
  id: "testFlow",
  name: "Test Flow",
  description: "test",
  triggerKeywords: ["test"],
  schema: { type: "object", properties: {}, required: [] },
};

function makeRegistry(handlerResult: FlowHandlerResult): FlowRegistry {
  const flow: LoadedFlow = {
    definition,
    handler: async () => handlerResult,
    // Read by chatter's extractParameters(); harmless since the client's
    // chat.completions.create() is mocked and the file's contents never
    // reach a real prompt.
    instructionsPath: `${import.meta.dir}/manager.test.ts`,
  };
  const stub = {
    getFlow: () => flow,
    matchFlow: async () => flow,
  } satisfies Pick<FlowRegistry, "getFlow" | "matchFlow">;
  return stub as unknown as FlowRegistry;
}

// extractParameters() only reads extractedParams from the response - it
// recomputes allParamsFilled itself from the (empty) schema, so that flag is
// inert here and the flow always completes in one turn.
function makeSucceedingClient(): TalkerDependencies["chatter"]["client"] {
  const create = mock(async () => ({
    choices: [{ message: { content: JSON.stringify({ extractedParams: {} }) } }],
  }));
  return {
    chat: { completions: { create } },
  } as unknown as TalkerDependencies["chatter"]["client"];
}

function makeFailingClient(): TalkerDependencies["chatter"]["client"] {
  const create = mock(async () => {
    throw new Error("OpenAI API error: 500");
  });
  return {
    chat: { completions: { create } },
  } as unknown as TalkerDependencies["chatter"]["client"];
}

function makeDeps(client = makeSucceedingClient()): TalkerDependencies {
  return {
    chatter: { client } as TalkerDependencies["chatter"],
    config: {},
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

describe("processFlow per-channel content", () => {
  beforeEach(() => {
    clearAllContexts();
  });

  it("carries distinct sms/whatsapp content through flow completion", async () => {
    const registry = makeRegistry({
      success: true,
      say: "SAY_TEXT",
      sms: "SMS_TEXT",
      whatsapp: "WHATSAPP_TEXT",
    });
    const deps = makeDeps();
    const phoneNumber = "+15551234567";

    getOrCreateContext(phoneNumber);
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "hello", "sms");

    expect(result.response).toBe("SAY_TEXT");
    expect(result.smsContent).toBe("SMS_TEXT");
    expect(result.whatsappContent).toBe("WHATSAPP_TEXT");
    expect(result.flowSuccess).toBe(true);
  });

  it("leaves smsContent/whatsappContent undefined when a handler omits them", async () => {
    const registry = makeRegistry({ success: true, say: "SAY_ONLY" });
    const deps = makeDeps();
    const phoneNumber = "+15551234568";

    getOrCreateContext(phoneNumber);
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "hello", "sms");

    expect(result.response).toBe("SAY_ONLY");
    expect(result.smsContent).toBeUndefined();
    expect(result.whatsappContent).toBeUndefined();
  });

  it("carries per-channel content through a freshly-triggered flow too", async () => {
    const registry = makeRegistry({
      success: true,
      say: "SAY_TEXT",
      sms: "SMS_TEXT",
      whatsapp: "WHATSAPP_TEXT",
    });
    const deps = makeDeps();
    const phoneNumber = "+15551234569";

    const result = await processFlow(deps, registry, phoneNumber, "start test flow", "whatsapp");

    expect(result.response).toBe("SAY_TEXT");
    expect(result.smsContent).toBe("SMS_TEXT");
    expect(result.whatsappContent).toBe("WHATSAPP_TEXT");
  });
});

describe("processFlow cancel and error outcomes", () => {
  beforeEach(() => {
    clearAllContexts();
  });

  it("marks a user cancellation and delivers the cancelled phrase", async () => {
    const registry = makeRegistry({ success: true, say: "UNUSED" });
    const deps = makeDeps();
    const phoneNumber = "+15551234570";

    getOrCreateContext(phoneNumber);
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "cancel", "sms");

    expect(result.cancelled).toBe(true);
    expect(result.isFlowActive).toBe(false);
    expect(result.flowCompleted).toBe(false);
    expect(result.response).toBe(getFlowPhrase("en", "cancelled"));
    expect(getActiveFlow(phoneNumber)).toBeFalsy();
  });

  it("marks an error and delivers the error phrase when the active flow is missing from the registry", async () => {
    const stub = {
      getFlow: () => undefined,
      matchFlow: async () => undefined,
    } satisfies Pick<FlowRegistry, "getFlow" | "matchFlow">;
    const registry = stub as unknown as FlowRegistry;
    const deps = makeDeps();
    const phoneNumber = "+15551234571";

    getOrCreateContext(phoneNumber);
    setActiveFlow(phoneNumber, "missingFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "hello", "sms");

    expect(result.error).toBe(true);
    expect(result.isFlowActive).toBe(false);
    expect(result.flowCompleted).toBe(false);
    expect(result.response).toBe(getFlowPhrase("en", "error"));
    expect(getActiveFlow(phoneNumber)).toBeFalsy();
  });

  it("marks an error and delivers the error phrase when parameter extraction fails mid-flow", async () => {
    const registry = makeRegistry({ success: true, say: "UNUSED" });
    const deps = makeDeps(makeFailingClient());
    const phoneNumber = "+15551234572";

    getOrCreateContext(phoneNumber);
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "hello", "sms");

    expect(result.error).toBe(true);
    expect(result.response).toBe(getFlowPhrase("en", "error"));
    expect(getActiveFlow(phoneNumber)).toBeFalsy();
  });

  it("marks an error, clears dangling active-flow state, and delivers the error phrase when a freshly-triggered flow fails to initialize", async () => {
    const registry = makeRegistry({ success: true, say: "UNUSED" });
    const deps = makeDeps(makeFailingClient());
    const phoneNumber = "+15551234573";

    const result = await processFlow(deps, registry, phoneNumber, "start test flow", "sms");

    expect(result.error).toBe(true);
    expect(result.response).toBe(getFlowPhrase("en", "error"));
    // setActiveFlow() runs before the throwing extraction call; the catch
    // must undo it or the next turn is wrongly treated as continuing this flow.
    expect(getActiveFlow(phoneNumber)).toBeFalsy();
  });
});

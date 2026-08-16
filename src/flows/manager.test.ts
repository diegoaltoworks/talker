/**
 * Flow Manager Tests
 *
 * Covers processFlow wiring a handler's per-channel content (say/sms/whatsapp)
 * through to FlowResult, its cancel/error outcomes, and the zero-parameter
 * short-circuit that keeps parameterless flows working without the optional
 * flow-engine peer.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  clearAllContexts,
  getActiveFlow,
  getOrCreateContext,
  setActiveFlow,
  setDetectedLanguage,
} from "../core/context";
import { getFlowPhrase } from "../core/phrases";
import type { TalkerDependencies } from "../types";
import { type FlowEngineLoader, loadFlowEngine } from "./engine";
import { processFlow } from "./manager";
import type { FlowRegistry } from "./registry";
import type { FlowDefinition, FlowHandlerResult, LoadedFlow } from "./types";

// One property, nothing required: chatter's extractParameters() recomputes
// allParamsFilled from `required`, so the flow completes in one turn while the
// extraction call itself is still exercised.
const definition: FlowDefinition = {
  id: "testFlow",
  name: "Test Flow",
  description: "test",
  triggerKeywords: ["test"],
  schema: { type: "object", properties: { detail: { type: "string" } }, required: [] },
};

/** A flow with a required parameter, so a turn can leave it unfilled. */
const requiredParamDefinition: FlowDefinition = {
  ...definition,
  schema: { type: "object", properties: { detail: { type: "string" } }, required: ["detail"] },
};

/** A parameterless flow, like the keyword-triggered human handoff. */
const parameterlessDefinition: FlowDefinition = {
  ...definition,
  schema: { type: "object", properties: {}, required: [] },
};

function makeRegistry(
  handlerResult: FlowHandlerResult,
  options: { definition?: FlowDefinition; engineLoader?: FlowEngineLoader } = {},
): FlowRegistry {
  const flow: LoadedFlow = {
    definition: options.definition ?? definition,
    handler: async () => handlerResult,
    // Read by chatter's extractParameters(); harmless since the client's
    // chat.completions.create() is mocked and the file's contents never
    // reach a real prompt.
    instructionsPath: `${import.meta.dir}/manager.test.ts`,
  };
  const stub = {
    getFlow: () => flow,
    matchFlow: async () => flow,
    getEngine: options.engineLoader ?? loadFlowEngine,
  } satisfies Pick<FlowRegistry, "getFlow" | "matchFlow" | "getEngine">;
  return stub as unknown as FlowRegistry;
}

// extractParameters() only reads extractedParams from the response - it
// recomputes allParamsFilled itself from the (empty) `required` list, so that
// flag is inert here and the flow always completes in one turn.
function makeSucceedingClient(): TalkerDependencies["openaiClient"] {
  const create = mock(async () => ({
    choices: [{ message: { content: JSON.stringify({ extractedParams: {} }) } }],
  }));
  return {
    chat: { completions: { create } },
  } as unknown as TalkerDependencies["openaiClient"];
}

function makeFailingClient(): TalkerDependencies["openaiClient"] {
  const create = mock(async () => {
    throw new Error("OpenAI API error: 500");
  });
  return {
    chat: { completions: { create } },
  } as unknown as TalkerDependencies["openaiClient"];
}

function makeDeps(client = makeSucceedingClient()): TalkerDependencies {
  return {
    openaiClient: client,
    config: {},
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

/** Distinct from `makeDeps(undefined)`, which - as a default-parameter call - still gets a client. */
function makeDepsWithoutClient(): TalkerDependencies {
  return { config: {}, openaiApiKey: "test-key", openaiModel: "gpt-4o-mini" };
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

describe("processFlow without the flow-engine peer", () => {
  beforeEach(() => {
    clearAllContexts();
  });

  // The critical-keyword branch of FlowRegistry.matchFlow reaches the human
  // handoff without an LLM call. That flow declares no parameters, so
  // processFlow must complete it without the engine too - otherwise the
  // handoff dies on a host that installed talker without chatter.
  it("completes a parameterless flow without loading the engine", async () => {
    const engineLoader = mock(() =>
      Promise.reject(new Error("Cannot find package '@diegoaltoworks/chatter'")),
    ) as unknown as FlowEngineLoader;
    const registry = makeRegistry(
      { success: true, say: "TRANSFERRING" },
      { definition: parameterlessDefinition, engineLoader },
    );
    const deps = makeDeps(makeFailingClient());

    const result = await processFlow(deps, registry, "+15551234574", "get me a human", "call");

    expect(result.response).toBe("TRANSFERRING");
    expect(result.flowCompleted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(engineLoader).not.toHaveBeenCalled();
  });

  it("delivers the error phrase when a parameterised flow cannot load the engine", async () => {
    const engineLoader = (() =>
      Promise.reject(
        new Error("Cannot find package '@diegoaltoworks/chatter'"),
      )) as FlowEngineLoader;
    const registry = makeRegistry({ success: true, say: "UNUSED" }, { engineLoader });
    const deps = makeDeps();
    const phoneNumber = "+15551234575";

    getOrCreateContext(phoneNumber);
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "hello", "sms");

    expect(result.error).toBe(true);
    expect(result.response).toBe(getFlowPhrase("en", "error"));
    expect(getActiveFlow(phoneNumber)).toBeFalsy();
  });
});

describe("processFlow speaks the caller's language", () => {
  beforeEach(() => {
    clearAllContexts();
  });

  /** An engine that fills nothing and offers no prompt of its own. */
  const silentEngine = (() =>
    Promise.resolve({
      extractParameters: async () => ({ extractedParams: {}, allParamsFilled: false }),
      detectIntent: async () => null,
    })) as unknown as FlowEngineLoader;

  it("asks for more details in the caller's language when the engine offers no prompt", async () => {
    const registry = makeRegistry(
      { success: true, say: "UNUSED" },
      { definition: requiredParamDefinition, engineLoader: silentEngine },
    );
    const deps = makeDeps();
    const phoneNumber = "+15551234576";

    getOrCreateContext(phoneNumber);
    setDetectedLanguage(phoneNumber, "fr");
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "bonjour", "call");

    expect(result.isFlowActive).toBe(true);
    expect(result.response).toBe(getFlowPhrase("fr", "needMoreDetails"));
    expect(result.response).not.toBe(getFlowPhrase("en", "needMoreDetails"));
  });

  it("asks for more details in the caller's language on the turn that starts the flow", async () => {
    const registry = makeRegistry(
      { success: true, say: "UNUSED" },
      { definition: requiredParamDefinition, engineLoader: silentEngine },
    );
    const deps = makeDeps();
    const phoneNumber = "+15551234577";

    getOrCreateContext(phoneNumber);
    setDetectedLanguage(phoneNumber, "es");

    const result = await processFlow(deps, registry, phoneNumber, "hola", "sms");

    expect(result.isFlowActive).toBe(true);
    expect(result.response).toBe(getFlowPhrase("es", "needMoreDetails"));
  });

  it("cancels on a keyword spoken in the caller's language, not only in English", async () => {
    const registry = makeRegistry({ success: true, say: "UNUSED" });
    const deps = makeDeps();
    const phoneNumber = "+15551234578";

    getOrCreateContext(phoneNumber);
    setDetectedLanguage(phoneNumber, "fr");
    setActiveFlow(phoneNumber, "testFlow", {});

    const result = await processFlow(deps, registry, phoneNumber, "annuler", "call");

    expect(result.cancelled).toBe(true);
    expect(result.response).toBe(getFlowPhrase("fr", "cancelled"));
    expect(getActiveFlow(phoneNumber)).toBeFalsy();
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
      getEngine: loadFlowEngine,
    } satisfies Pick<FlowRegistry, "getFlow" | "matchFlow" | "getEngine">;
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

  it("marks an error and delivers the error phrase when deps.openaiClient is unset mid-flow", async () => {
    const registry = makeRegistry({ success: true, say: "UNUSED" });
    const deps = makeDepsWithoutClient();
    const phoneNumber = "+15551234579";

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

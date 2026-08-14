/**
 * Flow Manager Tests
 *
 * Covers processFlow wiring a handler's per-channel content (say/sms/whatsapp)
 * through to FlowResult.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { clearAllContexts, getOrCreateContext, setActiveFlow } from "../core/context";
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
    // Read by extractParameters() below; harmless since fetch is mocked and the
    // file's contents never reach a real prompt.
    instructionsPath: `${import.meta.dir}/manager.test.ts`,
  };
  const stub = {
    getFlow: () => flow,
    matchFlow: async () => flow,
  } satisfies Pick<FlowRegistry, "getFlow" | "matchFlow">;
  return stub as unknown as FlowRegistry;
}

function makeDeps(): TalkerDependencies {
  return {
    chatter: {} as TalkerDependencies["chatter"],
    config: {},
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

describe("processFlow per-channel content", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAllContexts();
    // extractParameters() only reads extractedParams from this response - it
    // recomputes allParamsFilled itself from the (empty) schema, so that flag
    // is inert here and the flow always completes in one turn.
    global.fetch = mock(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ extractedParams: {} }),
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

/**
 * Flow directory contract test.
 *
 * Proves an on-disk flow (flow.json + handler.ts + instructions.md, the same
 * shape talker's flows have always used) loads and runs unchanged through the
 * chatter-backed adapter: FlowRegistry detects intent and processFlow
 * extracts parameters via `@diegoaltoworks/chatter/flows`, while directory
 * loading and the handler's own {success, say, sms, whatsapp} contract stay
 * talker's own, end to end across single- and multi-turn param collection.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearAllContexts } from "../core/context";
import type { TalkerDependencies } from "../types";
import { processFlow } from "./manager";
import { FlowRegistry } from "./registry";

const FLOW_JSON = JSON.stringify({
  id: "contractFlow",
  name: "Contract Flow",
  description: "Fixture flow validating the chatter-backed loader and intent detection end to end",
  triggerKeywords: ["contract"],
  schema: {
    type: "object",
    properties: { name: { type: "string", description: "Caller's name" } },
    required: ["name"],
  },
});

const HANDLER_TS = `
export async function execute(params, context) {
  return {
    success: true,
    say: \`Thanks, \${params.name}. Voice reply for \${context.channel}.\`,
    sms: \`Thanks, \${params.name}. SMS reply.\`,
    whatsapp: \`Thanks, \${params.name}. WhatsApp reply.\`,
    result: { name: params.name },
  };
}
`;

const INSTRUCTIONS_MD = "Extract the caller's name from their message.";

function makeFixtureFlowsDir(): string {
  const flowsDir = mkdtempSync(join(tmpdir(), "talker-flow-contract-"));
  const flowDir = join(flowsDir, "contractFlow");
  mkdirSync(flowDir);
  writeFileSync(join(flowDir, "flow.json"), FLOW_JSON);
  writeFileSync(join(flowDir, "handler.ts"), HANDLER_TS);
  writeFileSync(join(flowDir, "instructions.md"), INSTRUCTIONS_MD);
  return flowsDir;
}

// detectIntent() and extractParameters() use distinct, stable request shapes
// (temperature 0.1 vs 0.2) rather than prompt wording, so this fake doesn't
// break if chatter rewords either system prompt.
function makeFakeClient(extractedParamsByCall: Array<Record<string, unknown>>) {
  let extractCall = 0;
  const create = mock(async (body: { temperature: number }) => {
    if (body.temperature === 0.1) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "contractFlow",
                confidence: 0.95,
                reasoning: "keyword match",
              }),
            },
          },
        ],
      };
    }
    const extractedParams = extractedParamsByCall[extractCall] ?? {};
    extractCall += 1;
    return {
      choices: [{ message: { content: JSON.stringify({ extractedParams }) } }],
    };
  });
  return {
    chat: { completions: { create } },
  } as unknown as TalkerDependencies["openaiClient"];
}

describe("flow directory contract", () => {
  let flowsDir: string;

  beforeEach(() => {
    clearAllContexts();
    flowsDir = makeFixtureFlowsDir();
  });

  afterEach(() => {
    rmSync(flowsDir, { recursive: true, force: true });
  });

  it("loads a real flow.json/handler.ts/instructions.md directory and delivers per-channel content", async () => {
    const registry = new FlowRegistry(flowsDir);
    await registry.loadFlows();
    expect(registry.getAllFlows().map((f) => f.definition.id)).toEqual(["contractFlow"]);

    const deps: TalkerDependencies = {
      openaiClient: makeFakeClient([{ name: "Ada" }]),
      config: {},
      openaiApiKey: "test-key",
      openaiModel: "gpt-4o-mini",
    };

    const result = await processFlow(
      deps,
      registry,
      "+15550001111",
      "let's do the contract flow",
      "whatsapp",
    );

    expect(result.isFlowActive).toBe(false);
    expect(result.flowCompleted).toBe(true);
    expect(result.flowSuccess).toBe(true);
    expect(result.response).toBe("Thanks, Ada. Voice reply for whatsapp.");
    expect(result.smsContent).toBe("Thanks, Ada. SMS reply.");
    expect(result.whatsappContent).toBe("Thanks, Ada. WhatsApp reply.");
  });

  it("collects params across turns when the first message leaves a required field missing", async () => {
    const registry = new FlowRegistry(flowsDir);
    await registry.loadFlows();

    const deps: TalkerDependencies = {
      // First extraction turn finds nothing; second turn supplies `name`.
      openaiClient: makeFakeClient([{}, { name: "Ada" }]),
      config: {},
      openaiApiKey: "test-key",
      openaiModel: "gpt-4o-mini",
    };
    const phoneNumber = "+15550002222";

    const first = await processFlow(
      deps,
      registry,
      phoneNumber,
      "let's do the contract flow",
      "sms",
    );
    expect(first.isFlowActive).toBe(true);
    expect(first.flowCompleted).toBe(false);
    expect(first.response).toBe("What is the name?");

    const second = await processFlow(deps, registry, phoneNumber, "Ada", "sms");
    expect(second.isFlowActive).toBe(false);
    expect(second.flowCompleted).toBe(true);
    expect(second.flowSuccess).toBe(true);
    expect(second.smsContent).toBe("Thanks, Ada. SMS reply.");
  });
});

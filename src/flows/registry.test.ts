/**
 * Flow Registry tests.
 *
 * Focus: what happens on the matching path when the optional
 * `@diegoaltoworks/chatter` peer is unavailable. Intent detection needs the
 * engine and must degrade to "no flow matched" rather than reject — a rejection
 * here propagates out of processFlow and fails the webhook. Critical-keyword
 * matching makes no LLM call, so it must not consult the engine at all.
 *
 * The engine-backed success path is covered end to end in ./contract.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TalkerDependencies } from "../types";
import type { FlowEngineLoader } from "./engine";
import { FlowRegistry } from "./registry";

/** Zero-parameter human handoff — the flow the keyword branch exists to reach. */
const TRANSFER_JSON = JSON.stringify({
  id: "transfer",
  name: "Transfer",
  description: "Hand the caller to a person",
  triggerKeywords: ["human", "agent"],
  schema: { type: "object", properties: {}, required: [] },
});

const HANDLER_TS = "export async function execute() { return { success: true, say: 'ok' }; }\n";

let flowsDir: string;

beforeEach(() => {
  flowsDir = mkdtempSync(join(tmpdir(), "talker-registry-"));
  const flowDir = join(flowsDir, "transfer");
  mkdirSync(flowDir);
  writeFileSync(join(flowDir, "flow.json"), TRANSFER_JSON);
  writeFileSync(join(flowDir, "handler.ts"), HANDLER_TS);
  writeFileSync(join(flowDir, "instructions.md"), "Handoff.");
});

afterEach(() => {
  rmSync(flowsDir, { recursive: true, force: true });
});

/** A client whose use would mean an unexpected LLM call. */
function makeUnusedClient(): TalkerDependencies["chatter"]["client"] {
  return {
    chat: {
      completions: {
        create: mock(async () => {
          throw new Error("no LLM call expected");
        }),
      },
    },
  } as unknown as TalkerDependencies["chatter"]["client"];
}

function makeDeps(): TalkerDependencies {
  return {
    chatter: { client: makeUnusedClient() },
    openaiModel: "test-model",
  } as unknown as TalkerDependencies;
}

describe("FlowRegistry.matchFlow", () => {
  it("returns the handoff flow on a critical keyword without loading the engine", async () => {
    const engineLoader = mock(() =>
      Promise.reject(new Error("engine must not be loaded for keyword matching")),
    ) as unknown as FlowEngineLoader;
    const registry = new FlowRegistry(flowsDir, engineLoader);
    await registry.loadFlows();

    const matched = await registry.matchFlow(makeDeps(), "+441234567890", "get me a human");

    expect(matched?.definition.id).toBe("transfer");
    expect(engineLoader).not.toHaveBeenCalled();
  });

  it("matches the plural form of a critical keyword", async () => {
    const engineLoader = mock(() =>
      Promise.reject(new Error("engine must not be loaded for keyword matching")),
    ) as unknown as FlowEngineLoader;
    const registry = new FlowRegistry(flowsDir, engineLoader);
    await registry.loadFlows();

    const matched = await registry.matchFlow(
      makeDeps(),
      "+441234567890",
      "let me talk to one of your agents",
    );

    expect(matched?.definition.id).toBe("transfer");
  });

  it("does not treat a keyword substring inside another word as a critical keyword", async () => {
    const engineLoader = (() =>
      Promise.reject(new Error("Cannot find package"))) as FlowEngineLoader;
    const registry = new FlowRegistry(flowsDir, engineLoader);
    await registry.loadFlows();

    // "person" is a critical keyword, but "personality" must not match it -
    // this should reach (and fail open past) intent detection instead of
    // triggering the handoff flow.
    const matched = await registry.matchFlow(
      makeDeps(),
      "+441234567890",
      "tell me about your personality",
    );

    expect(matched).toBeUndefined();
  });

  it("matches no flow, rather than rejecting, when the engine peer is absent", async () => {
    const engineLoader = (() =>
      Promise.reject(new Error("Cannot find package"))) as FlowEngineLoader;
    const registry = new FlowRegistry(flowsDir, engineLoader);
    await registry.loadFlows();

    // No critical keyword, so this reaches the intent-detection step.
    const matched = await registry.matchFlow(makeDeps(), "+441234567890", "what are your hours?");

    expect(matched).toBeUndefined();
  });

  it("skips intent detection when no flows are loaded", async () => {
    const engineLoader = mock(() =>
      Promise.reject(new Error("engine must not be loaded with an empty registry")),
    ) as unknown as FlowEngineLoader;
    const registry = new FlowRegistry("", engineLoader);
    await registry.loadFlows();

    expect(await registry.matchFlow(makeDeps(), "+441234567890", "hello")).toBeUndefined();
    expect(engineLoader).not.toHaveBeenCalled();
  });
});

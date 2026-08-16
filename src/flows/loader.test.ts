/**
 * Flow directory loader tests, focused on the schema validation this fork
 * intentionally diverges on: talker's loader accepts a zero-parameter flow
 * (chatter's loader would reject it), but must still require the
 * `properties` key itself, since extractFlowParams (./manager.ts) reads it
 * unconditionally.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFlowsFromDirectory } from "./loader";

const HANDLER_TS = `
export async function execute(params, context) {
  return { success: true, say: "done" };
}
`;

const INSTRUCTIONS_MD = "No parameters to extract.";

function writeFlow(flowsDir: string, flowName: string, definition: unknown): void {
  const flowDir = join(flowsDir, flowName);
  mkdirSync(flowDir);
  writeFileSync(join(flowDir, "flow.json"), JSON.stringify(definition));
  writeFileSync(join(flowDir, "handler.ts"), HANDLER_TS);
  writeFileSync(join(flowDir, "instructions.md"), INSTRUCTIONS_MD);
}

describe("loadFlowsFromDirectory", () => {
  let flowsDir: string;

  beforeEach(() => {
    flowsDir = mkdtempSync(join(tmpdir(), "talker-flow-loader-"));
  });

  afterEach(() => {
    rmSync(flowsDir, { recursive: true, force: true });
  });

  it("loads a zero-parameter flow (empty schema.properties)", async () => {
    writeFlow(flowsDir, "handoff", {
      id: "handoff",
      name: "Human handoff",
      description: "Transfers to a human",
      triggerKeywords: ["human"],
      schema: { type: "object", properties: {}, required: [] },
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("handoff")).toBe(true);
    expect(flows.get("handoff")?.definition.schema.properties).toEqual({});
  });

  it("loads a flow with populated schema.properties", async () => {
    writeFlow(flowsDir, "addNumbers", {
      id: "addNumbers",
      name: "Add numbers",
      description: "Adds two numbers",
      triggerKeywords: ["add"],
      schema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("addNumbers")).toBe(true);
  });

  it("skips a flow whose schema is missing the properties key entirely", async () => {
    writeFlow(flowsDir, "broken", {
      id: "broken",
      name: "Broken",
      description: "Missing properties",
      triggerKeywords: ["broken"],
      schema: { type: "object" },
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("broken")).toBe(false);
  });

  it("skips a flow with no schema at all", async () => {
    writeFlow(flowsDir, "noschema", {
      id: "noschema",
      name: "No schema",
      description: "Missing schema",
      triggerKeywords: ["noschema"],
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("noschema")).toBe(false);
  });

  it("skips a flow whose schema.properties is null", async () => {
    writeFlow(flowsDir, "nullprops", {
      id: "nullprops",
      name: "Null properties",
      description: "properties is null",
      triggerKeywords: ["nullprops"],
      schema: { type: "object", properties: null },
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("nullprops")).toBe(false);
  });

  it("skips a flow whose schema.properties is an array", async () => {
    writeFlow(flowsDir, "arrayprops", {
      id: "arrayprops",
      name: "Array properties",
      description: "properties is an array",
      triggerKeywords: ["arrayprops"],
      schema: { type: "object", properties: [] },
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("arrayprops")).toBe(false);
  });
});

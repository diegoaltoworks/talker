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

  it("defaults contractVersion to 1 when flow.json omits it", async () => {
    writeFlow(flowsDir, "unversioned", {
      id: "unversioned",
      name: "Unversioned",
      description: "No contractVersion field",
      triggerKeywords: ["unversioned"],
      schema: { type: "object", properties: {}, required: [] },
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.get("unversioned")?.definition.contractVersion).toBe(1);
  });

  it("loads a flow with an explicit, supported contractVersion", async () => {
    writeFlow(flowsDir, "versioned", {
      id: "versioned",
      name: "Versioned",
      description: "Explicit contractVersion",
      triggerKeywords: ["versioned"],
      schema: { type: "object", properties: {}, required: [] },
      contractVersion: 1,
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.get("versioned")?.definition.contractVersion).toBe(1);
  });

  it("skips a flow whose contractVersion is newer than this loader understands", async () => {
    writeFlow(flowsDir, "future", {
      id: "future",
      name: "Future",
      description: "Contract from the future",
      triggerKeywords: ["future"],
      schema: { type: "object", properties: {}, required: [] },
      contractVersion: 99,
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("future")).toBe(false);
  });

  it("skips a flow whose contractVersion is not a positive integer", async () => {
    writeFlow(flowsDir, "fractional", {
      id: "fractional",
      name: "Fractional",
      description: "Non-integer contractVersion",
      triggerKeywords: ["fractional"],
      schema: { type: "object", properties: {}, required: [] },
      contractVersion: 1.5,
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("fractional")).toBe(false);
  });

  it("skips a flow whose contractVersion is zero or negative", async () => {
    writeFlow(flowsDir, "zeroed", {
      id: "zeroed",
      name: "Zeroed",
      description: "Non-positive contractVersion",
      triggerKeywords: ["zeroed"],
      schema: { type: "object", properties: {}, required: [] },
      contractVersion: 0,
    });
    writeFlow(flowsDir, "negative", {
      id: "negative",
      name: "Negative",
      description: "Negative contractVersion",
      triggerKeywords: ["negative"],
      schema: { type: "object", properties: {}, required: [] },
      contractVersion: -1,
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("zeroed")).toBe(false);
    expect(flows.has("negative")).toBe(false);
  });

  it("skips a flow whose contractVersion is a string, not a number", async () => {
    writeFlow(flowsDir, "stringed", {
      id: "stringed",
      name: "Stringed",
      description: "contractVersion given as a JSON string",
      triggerKeywords: ["stringed"],
      schema: { type: "object", properties: {}, required: [] },
      contractVersion: "1",
    });

    const flows = await loadFlowsFromDirectory(flowsDir);

    expect(flows.has("stringed")).toBe(false);
  });
});

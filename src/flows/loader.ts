/**
 * Dynamic Flow Loader
 *
 * Discovers and loads flow definitions from the filesystem.
 * Each flow is a directory containing: flow.json, handler.ts, instructions.md
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../core/logger";
import type { FlowDefinition, FlowHandler, FlowPrefill, LoadedFlow } from "../types";

/**
 * Load all flows from a directory
 */
export async function loadFlowsFromDirectory(flowsDir: string): Promise<Map<string, LoadedFlow>> {
  const flows = new Map<string, LoadedFlow>();

  if (!existsSync(flowsDir)) {
    logger.warn("flows directory does not exist", { flowsDir });
    return flows;
  }

  const flowDirs = readdirSync(flowsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => ["lib", "tests", "registry"].indexOf(dirent.name) === -1)
    .map((dirent) => dirent.name);

  logger.info("loading flows", { count: flowDirs.length, flowDirs });

  for (const flowName of flowDirs) {
    try {
      const flow = await loadFlow(flowsDir, flowName);
      flows.set(flowName, flow);
      logger.info("flow loaded", { flowName });
    } catch (error) {
      logger.error("failed to load flow", {
        flowName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("flows loaded", { count: flows.size, flows: Array.from(flows.keys()) });
  return flows;
}

async function loadFlow(flowsDir: string, flowName: string): Promise<LoadedFlow> {
  const flowPath = join(flowsDir, flowName);
  const definitionPath = join(flowPath, "flow.json");
  const instructionsPath = join(flowPath, "instructions.md");
  const handlerPath = join(flowPath, "handler.ts");

  if (!existsSync(definitionPath)) {
    throw new Error(`flow.json not found for ${flowName}`);
  }
  if (!existsSync(instructionsPath)) {
    throw new Error(`instructions.md not found for ${flowName}`);
  }
  if (!existsSync(handlerPath)) {
    throw new Error(`handler.ts not found for ${flowName}`);
  }

  const definitionContent = readFileSync(definitionPath, "utf-8");
  const definition = JSON.parse(definitionContent) as FlowDefinition;

  if (definition.id !== flowName) {
    throw new Error(`Flow id mismatch: ${definition.id} !== ${flowName}`);
  }
  if (!definition.triggerKeywords || definition.triggerKeywords.length === 0) {
    throw new Error(`Flow ${flowName} has no trigger keywords`);
  }
  if (!definition.schema || Object.keys(definition.schema).length === 0) {
    throw new Error(`Flow ${flowName} has no schema`);
  }

  const handlerModule = await import(handlerPath);
  const handler = handlerModule.execute as FlowHandler;

  if (typeof handler !== "function") {
    throw new Error(`Flow ${flowName} handler.ts must export an 'execute' function`);
  }

  const prefillPath = join(flowPath, "prefill.ts");
  let prefill: FlowPrefill | undefined;
  if (existsSync(prefillPath)) {
    const prefillModule = await import(prefillPath);
    prefill = prefillModule.prefillFromContext as FlowPrefill;
    if (typeof prefill !== "function") {
      logger.warn("flow prefill.ts does not export prefillFromContext function", { flowName });
      prefill = undefined;
    }
  }

  return {
    definition,
    handler,
    instructionsPath,
    prefill,
  };
}

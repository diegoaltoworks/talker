/**
 * Dynamic Flow Loader
 *
 * Discovers and loads flow definitions from the filesystem.
 * Each flow is a directory containing: flow.json, handler.ts, instructions.md
 *
 * Kept as talker's own implementation (not chatter's) because chatter's
 * loader requires at least one schema property per flow, which would silently
 * drop zero-parameter flows like a keyword-triggered human handoff.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "../core/logger";
import type { FlowDefinition, FlowHandler, FlowPrefill, LoadedFlow } from "../types";
import { CURRENT_FLOW_CONTRACT_VERSION } from "../types";

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
  // Resolve to an absolute path: dynamic import() treats a relative path like
  // "config/flows/x/handler.ts" as a bare module specifier (a package name),
  // which fails at runtime in bundled deployments even when existsSync passes.
  const flowPath = resolve(flowsDir, flowName);
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
  const schemaProperties = definition.schema?.properties;
  if (
    !schemaProperties ||
    typeof schemaProperties !== "object" ||
    Array.isArray(schemaProperties)
  ) {
    // `properties` may legitimately be `{}` (a zero-parameter flow, e.g. a
    // keyword-triggered handoff) - that's what this loader fork exists to
    // allow, unlike chatter's loader which rejects an empty properties
    // object outright. What must be present is a `properties` object at all:
    // extractFlowParams (../flows/manager.ts) reads it unconditionally, so a
    // schema with `properties` missing, `null` or an array would throw a
    // TypeError deep in the flow pipeline instead of a clear error here.
    throw new Error(`Flow ${flowName} has no schema.properties`);
  }

  if (definition.contractVersion !== undefined) {
    const version = definition.contractVersion;
    if (!Number.isInteger(version) || version < 1 || version > CURRENT_FLOW_CONTRACT_VERSION) {
      throw new Error(
        `Flow ${flowName}: "contractVersion" ${JSON.stringify(version)} is not supported ` +
          `(this loader understands versions 1 through ${CURRENT_FLOW_CONTRACT_VERSION})`,
      );
    }
  }
  definition.contractVersion ??= CURRENT_FLOW_CONTRACT_VERSION;

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

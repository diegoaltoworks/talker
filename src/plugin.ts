/**
 * Talker Plugin
 *
 * Main entry point for integrating talker with chatter via the customRoutes hook.
 * Creates telephony routes and mounts them on the Hono app.
 *
 * @example
 * ```typescript
 * import { createServer } from "@diegoaltoworks/chatter";
 * import { createTelephonyRoutes } from "@diegoaltoworks/talker";
 *
 * const app = await createServer({
 *   ...chatterConfig,
 *   customRoutes: (app, deps) => {
 *     createTelephonyRoutes(app, deps, {
 *       twilio: { accountSid, authToken, phoneNumber },
 *       transferNumber: "+44...",
 *       flowsDir: "./config/flows",
 *     });
 *   },
 * });
 * ```
 */

import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type { Hono } from "hono";
import { startCleanup } from "./core/context";
import { logger } from "./core/logger";
import { FlowRegistry } from "./flows/registry";
import { callRoutes } from "./routes/call";
import { smsRoutes } from "./routes/sms";
import type { TalkerConfig, TalkerDependencies } from "./types";

const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Create and mount telephony routes on a Hono app (chatter plugin mode)
 */
export async function createTelephonyRoutes(
  app: Hono,
  chatterDeps: ServerDependencies,
  config: TalkerConfig,
): Promise<void> {
  logger.info("initializing telephony routes");

  const openaiApiKey = config.openaiApiKey || chatterDeps.config.openai.apiKey;
  if (!openaiApiKey) {
    throw new Error("OpenAI API key required for talker");
  }

  const deps: TalkerDependencies = {
    chatter: chatterDeps,
    config,
    openaiApiKey,
    openaiModel: config.processing?.model || DEFAULT_MODEL,
  };

  const registry = new FlowRegistry(config.flowsDir || "");
  if (config.flowsDir) {
    await registry.loadFlows();
  }

  startCleanup(
    config.contextTtlMs ?? DEFAULT_CONTEXT_TTL_MS,
    config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
  );

  const prefix = config.routePrefix || "";
  app.route(prefix, callRoutes(deps, registry));
  app.route(prefix, smsRoutes(deps, registry));

  logger.info("telephony routes mounted", {
    prefix: prefix || "/",
    hasFlows: !!config.flowsDir,
    flowCount: registry.getAllFlows().length,
    hasTransferNumber: !!config.transferNumber,
  });
}

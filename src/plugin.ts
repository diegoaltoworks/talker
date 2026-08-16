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
import { logger } from "./core/logger";
import { assertWebhookSecurity } from "./core/webhook-security";
import { initDbClient } from "./db/client";
import { runMigrations } from "./db/migrate";
import { FlowRegistry } from "./flows/registry";
import { mountTelephony } from "./mount";
import type { TalkerConfig, TalkerDependencies } from "./types";

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

  assertWebhookSecurity(config);

  // Resolve publicUrl: explicit config > chatter's bot.publicUrl > undefined
  const resolvedConfig: TalkerConfig = {
    ...config,
    publicUrl: config.publicUrl || chatterDeps.config.bot?.publicUrl,
  };

  const deps: TalkerDependencies = {
    chatter: chatterDeps,
    openaiClient: chatterDeps.client,
    config: resolvedConfig,
    openaiApiKey,
    openaiModel: config.processing?.model || DEFAULT_MODEL,
  };

  // Initialize database — use talker's config, or fall back to chatter's database
  const dbUrl = config.database?.url || chatterDeps.config.database?.url;
  const dbToken = config.database?.authToken || chatterDeps.config.database?.authToken;
  if (dbUrl && dbToken) {
    await initDbClient(dbUrl, dbToken);
    await runMigrations();
  }

  const registry = new FlowRegistry(config.flowsDir || "");
  if (config.flowsDir) {
    await registry.loadFlows();
  }

  mountTelephony(app, deps, registry);
}

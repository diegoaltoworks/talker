/**
 * Standalone Server
 *
 * Creates a self-contained Hono server with telephony routes.
 * Use this when running talker WITHOUT chatter — you provide your own
 * chatFn to handle the actual chatbot logic.
 *
 * @example
 * ```typescript
 * import { createStandaloneServer } from "@diegoaltoworks/talker";
 *
 * const app = await createStandaloneServer({
 *   openaiApiKey: process.env.OPENAI_API_KEY!,
 *   twilio: {
 *     accountSid: process.env.TWILIO_ACCOUNT_SID,
 *     authToken: process.env.TWILIO_AUTH_TOKEN,
 *     phoneNumber: process.env.TWILIO_PHONE_NUMBER,
 *   },
 *   transferNumber: "+441234567890",
 *   chatFn: async (phoneNumber, message) => {
 *     // Your chatbot logic here
 *     return "I received your message: " + message;
 *   },
 * });
 *
 * Bun.serve({ port: 3000, fetch: app.fetch });
 * ```
 */

import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { startCleanup } from "./core/context";
import { logger } from "./core/logger";
import { initDbClient } from "./db/client";
import { runMigrations } from "./db/migrate";
import { FlowRegistry } from "./flows/registry";
import { callRoutes } from "./routes/call";
import { smsRoutes } from "./routes/sms";
import { whatsappRoutes } from "./routes/whatsapp";
import type { TalkerConfig, TalkerDependencies } from "./types";

const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MODEL = "gpt-4o-mini";

export interface StandaloneConfig extends TalkerConfig {
  /** OpenAI API key (required in standalone mode) */
  openaiApiKey: string;
  /** Enable CORS. Default: true */
  cors?: boolean;
}

/**
 * Create a standalone Hono server with telephony routes.
 *
 * This does NOT require chatter. Provide a `chatFn` to handle chatbot logic,
 * or leave it undefined for a telephony-only server (flows + transfer only).
 */
export async function createStandaloneServer(config: StandaloneConfig) {
  logger.info("initializing standalone talker server");

  if (!config.openaiApiKey) {
    throw new Error("openaiApiKey is required for standalone mode");
  }

  // Build a minimal ServerDependencies stub for standalone mode.
  // Only the fields talker actually needs are populated.
  const stubChatterDeps = {
    config: { openai: { apiKey: config.openaiApiKey } },
  } as unknown as ServerDependencies;

  const deps: TalkerDependencies = {
    chatter: stubChatterDeps,
    config,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.processing?.model || DEFAULT_MODEL,
  };

  // Initialize database if configured
  if (config.database?.url && config.database?.authToken) {
    initDbClient(config.database.url, config.database.authToken);
    await runMigrations();
  }

  // Initialize flow registry
  const registry = new FlowRegistry(config.flowsDir || "");
  if (config.flowsDir) {
    await registry.loadFlows();
  }

  // Start context cleanup
  startCleanup(
    config.contextTtlMs ?? DEFAULT_CONTEXT_TTL_MS,
    config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
  );

  // Create Hono app
  const app = new Hono();

  // Health check
  app.get("/healthz", (c) => c.text("ok"));

  // Mount telephony routes
  const prefix = config.routePrefix || "";
  app.route(prefix, callRoutes(deps, registry));
  app.route(prefix, smsRoutes(deps, registry));
  app.route(prefix, whatsappRoutes(deps, registry));

  logger.info("standalone talker server ready", {
    prefix: prefix || "/",
    hasFlows: !!config.flowsDir,
    flowCount: registry.getAllFlows().length,
    hasChatFn: !!config.chatFn,
    hasTransferNumber: !!config.transferNumber,
  });

  return app;
}

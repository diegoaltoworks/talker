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

import { Hono } from "hono";
import { cors } from "hono/cors";
import { DEFAULT_PROCESSING_MODEL } from "./core/defaults";
import { logger } from "./core/logger";
import { assertWebhookSecurity } from "./core/webhook-security";
import { resolveStore } from "./db/resolve-store";
import { FlowRegistry } from "./flows/registry";
import { mountTelephony } from "./mount";
import type { TalkerConfig, TalkerDependencies } from "./types";

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

  assertWebhookSecurity(config);

  // Resolve the session/message/status store: `config.store` if set, else
  // `config.database` if set, else a no-op. See src/db/resolve-store.ts.
  const store = await resolveStore(config);

  // Initialize flow registry. Flow intent detection and parameter extraction
  // need a real OpenAI SDK client (chatter's flow engine calls it directly),
  // so `openai` is only imported here - kept a true optional peer for
  // standalone deployments that don't use flows.
  const registry = new FlowRegistry(config.flowsDir || "");
  let openaiClient: TalkerDependencies["openaiClient"];
  if (config.flowsDir) {
    const { default: OpenAI } = await import("openai").catch(() => {
      throw new Error(
        "flowsDir is configured but the optional peer dependency 'openai' is not installed",
      );
    });
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    await registry.loadFlows();
  }

  // No `chatter` here: standalone mode has no real `ServerDependencies` to
  // hand over (no VectorStore, no PromptLoader, no db) - leaving it unset is
  // more honest than faking one with a cast. `src/core/chat.ts`'s chatter
  // pipeline branch only runs when `chatFn`/`chatbot` are both unconfigured,
  // and explicitly guards on `deps.chatter` being present.
  const deps: TalkerDependencies = {
    openaiClient,
    config,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.processing?.model || DEFAULT_PROCESSING_MODEL,
    store,
  };

  // Create Hono app
  const app = new Hono();

  if (config.cors !== false) {
    app.use("*", cors());
  }

  // Health check
  app.get("/healthz", (c) => c.text("ok"));

  mountTelephony(app, deps, registry);

  logger.info("standalone talker server ready", {
    hasChatFn: !!config.chatFn,
  });

  return app;
}

/**
 * Shared route mounting for plugin and standalone mode.
 *
 * `createTelephonyRoutes` (plugin.ts) and `createStandaloneServer`
 * (standalone.ts) both wire up the same cleanup sweep and route tree once
 * their mode-specific setup (chatter dependencies vs. a standalone OpenAI
 * client, database fallback rules, flow registry loading) has produced a
 * `TalkerDependencies` and a loaded `FlowRegistry`. `mountTelephony` is that
 * shared tail, so the two modes cannot drift on it the way two hand-copied
 * blocks eventually do. It lives at the top level, a peer of plugin.ts and
 * standalone.ts, rather than under core/ - it is composition-root code that
 * depends on routes/ and flows/, not a leaf `core/` shares with them.
 *
 * What stays mode-specific, and why: database initialization (plugin mode
 * falls back to chatter's database config, standalone has none to fall back
 * to) and flow-registry bootstrap (standalone must create its own OpenAI
 * client for `deps.openaiClient` before loading flows; plugin mode already
 * has chatter's client) happen in each caller before this runs.
 */

import type { Hono } from "hono";
import { sweepConversations } from "./core/chatbot/conversations";
import { configureContextStore, startCleanup } from "./core/context";
import {
  DEFAULT_CLEANUP_INTERVAL_MS,
  DEFAULT_CONTEXT_TTL_MS,
  DEFAULT_PENDING_QUERY_TTL_MS,
} from "./core/defaults";
import { logger } from "./core/logger";
import type { FlowRegistry } from "./flows/registry";
import { callRoutes } from "./routes/call";
import { sweepPending } from "./routes/call/pending";
import { messagingRoutes } from "./routes/messaging";
import type { TalkerDependencies } from "./types";

/**
 * Apply an explicitly-injected `config.contextStore`, start the shared
 * cleanup sweep (context, pending queries, chatbot conversations), and mount
 * the call/sms/whatsapp route trees under `config.routePrefix`.
 *
 * `config.contextStore` is only applied when set - `src/core/context.ts`
 * already defaults to an in-memory store at module load, shared across
 * mounts in the same process. Configuring it unconditionally here would
 * replace that shared default on every mount (including a second
 * `createTelephonyRoutes`/`createStandaloneServer` call in one process,
 * which `startCleanup` below explicitly supports), orphaning whatever the
 * first mount's contexts held.
 */
export function mountTelephony(app: Hono, deps: TalkerDependencies, registry: FlowRegistry): void {
  const { config } = deps;

  if (config.contextStore) {
    configureContextStore(config.contextStore);
  }

  const contextTtlMs = config.contextTtlMs ?? DEFAULT_CONTEXT_TTL_MS;
  startCleanup(contextTtlMs, config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS, () => {
    sweepPending(config.pendingQueryTtlMs ?? DEFAULT_PENDING_QUERY_TTL_MS);
    sweepConversations(contextTtlMs);
  });

  const prefix = config.routePrefix || "";
  app.route(prefix, callRoutes(deps, registry));
  app.route(prefix, messagingRoutes(deps, registry, "sms"));
  app.route(prefix, messagingRoutes(deps, registry, "whatsapp"));

  logger.info("telephony routes mounted", {
    prefix: prefix || "/",
    hasFlows: !!config.flowsDir,
    flowCount: registry.getAllFlows().length,
    hasTransferNumber: !!config.transferNumber,
  });
}

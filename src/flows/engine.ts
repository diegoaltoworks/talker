/**
 * Lazy accessor for chatter's flow engine.
 *
 * `@diegoaltoworks/chatter` is an *optional* peer dependency: a top-level
 * value import of `@diegoaltoworks/chatter/flows` anywhere in the module graph
 * makes `import "@diegoaltoworks/talker"` throw for a host that installed only
 * hono, which breaks both the standalone quick start and voice-only usage.
 * Loading the engine at first use instead keeps import time clean and turns a
 * missing peer into an actionable error on the code path that needs it.
 * (Repeat loads are cheap - the ESM registry caches the module.)
 *
 * The same reasoning applies to `openai` (see src/standalone.ts) and
 * `@libsql/client` (see src/db/client.ts); src/peer-deps.test.ts enforces it
 * across the whole source tree.
 */

import type { detectIntent, extractParameters } from "@diegoaltoworks/chatter/flows";
import { getErrorMessage } from "../core/errors";

export interface FlowEngine {
  detectIntent: typeof detectIntent;
  extractParameters: typeof extractParameters;
}

/** How a FlowRegistry obtains the engine. Injectable so the peer-absent path is testable. */
export type FlowEngineLoader = () => Promise<FlowEngine>;

const UNLOADABLE_PEER =
  "Flow intent detection and parameter extraction require the optional peer dependency " +
  "'@diegoaltoworks/chatter', which could not be loaded. Install it " +
  "(e.g. `bun add @diegoaltoworks/chatter`) or leave `flowsDir` unset to run without flows.";

/**
 * Load chatter's flow engine, rejecting with an actionable message when the
 * peer is not installed.
 */
export const loadFlowEngine: FlowEngineLoader = () =>
  import("@diegoaltoworks/chatter/flows").catch((error: unknown) => {
    throw new Error(`${UNLOADABLE_PEER} (${getErrorMessage(error)})`);
  });

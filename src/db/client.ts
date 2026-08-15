/**
 * Database Client
 *
 * Lazy-initialized Turso/libSQL client.
 * Returns null when not configured — all callers handle this gracefully.
 *
 * `@libsql/client` is an *optional* peer dependency, so it is imported at
 * initialization time rather than at module load: a top-level value import
 * here would make `import "@diegoaltoworks/talker"` throw for a host that
 * installed only hono (see src/peer-deps.test.ts, which enforces this across
 * the source tree). A host that configures a database URL but never installed
 * the driver gets an actionable error naming the package.
 */

import type { Client } from "@libsql/client";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";

const UNLOADABLE_PEER =
  "Session persistence requires the optional peer dependency '@libsql/client', which could " +
  "not be loaded. Install it (e.g. `bun add @libsql/client`) or omit `database` from the config.";

let client: Client | null = null;

/**
 * Initialize the database client from config.
 * Called once during setup; subsequent calls to getDbClient() return the cached client.
 *
 * Throws when `@libsql/client` is not installed — a configured database with
 * no driver is a deployment mistake, not a runtime condition to degrade past.
 * Other connection failures keep the historical behavior: logged, client stays
 * null, callers carry on without persistence.
 */
export async function initDbClient(url: string, authToken: string): Promise<void> {
  if (client) return;

  const { createClient } = await import("@libsql/client").catch((error: unknown) => {
    throw new Error(`${UNLOADABLE_PEER} (${getErrorMessage(error)})`);
  });

  try {
    client = createClient({ url, authToken });
    logger.info("database client initialized", {
      url: url.replace(/:[^:]*@/, ":***@"),
    });
  } catch (error) {
    logger.error("failed to initialize database client", {
      error: getErrorMessage(error),
    });
  }
}

/**
 * Set the database client directly (for testing with mock/in-memory clients).
 */
export function setDbClient(mockClient: Client | null): void {
  client = mockClient;
}

/**
 * Get the database client. Returns null if not configured.
 */
export function getDbClient(): Client | null {
  return client;
}

/**
 * Close the database client.
 */
export async function closeDbClient(): Promise<void> {
  if (client) {
    try {
      client.close();
      client = null;
      logger.info("database client closed");
    } catch (error) {
      logger.error("error closing database client", {
        error: getErrorMessage(error),
      });
    }
  }
}

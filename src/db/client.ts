/**
 * Database Client
 *
 * Lazy-initialized Turso/libSQL client.
 * Returns null when not configured — all callers handle this gracefully.
 */

import { type Client, createClient } from "@libsql/client";
import { logger } from "../core/logger";

let client: Client | null = null;

/**
 * Initialize the database client from config.
 * Called once during setup; subsequent calls to getDbClient() return the cached client.
 */
export function initDbClient(url: string, authToken: string): void {
  if (client) return;

  try {
    client = createClient({ url, authToken });
    logger.info("database client initialized", {
      url: url.replace(/:[^:]*@/, ":***@"),
    });
  } catch (error) {
    logger.error("failed to initialize database client", {
      error: error instanceof Error ? error.message : "Unknown",
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
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }
}

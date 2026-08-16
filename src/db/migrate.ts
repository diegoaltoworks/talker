/**
 * Database Migrations
 *
 * Creates the talker_sessions, talker_messages and talker_message_status
 * tables. Safe to run multiple times (uses IF NOT EXISTS). Statements are
 * single-sourced from `./schema.ts`, shared with `libsql-store.ts`'s queries.
 */

import type { Client } from "@libsql/client";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import { getDbClient } from "./client";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * `client` defaults to the legacy singleton (`./client.ts`) when omitted,
 * matching the pre-`TalkerStore` call shape (`initDbClient(...)` then
 * `runMigrations()`) - `resolveStore` (`./resolve-store.ts`) always passes
 * one explicitly.
 */
export async function runMigrations(client: Client | null = getDbClient()): Promise<void> {
  if (!client) {
    logger.warn("cannot run migrations - database not configured");
    return;
  }

  try {
    logger.info("running database migrations", { statementCount: SCHEMA_STATEMENTS.length });

    for (const statement of SCHEMA_STATEMENTS) {
      await client.execute(statement);
    }

    logger.info("database migrations completed");
  } catch (error) {
    logger.error("database migration failed", {
      error: getErrorMessage(error),
    });
    throw error;
  }
}

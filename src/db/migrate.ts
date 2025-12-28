/**
 * Database Migrations
 *
 * Runs the schema.sql against the configured database.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../core/logger";
import { getDbClient } from "./client";

export async function runMigrations(): Promise<void> {
  const client = getDbClient();

  if (!client) {
    logger.warn("cannot run migrations - database not configured");
    return;
  }

  try {
    const schemaPath = join(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");

    const statements = schema
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    logger.info("running database migrations", { statementCount: statements.length });

    for (const statement of statements) {
      await client.execute(statement);
    }

    logger.info("database migrations completed");
  } catch (error) {
    logger.error("database migration failed", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    throw error;
  }
}

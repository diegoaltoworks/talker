/**
 * Database Module
 *
 * Optional session persistence to Turso/libSQL.
 * Activates when database.url and database.authToken are provided in config.
 */

export { closeDbClient, getDbClient, initDbClient } from "./client";
export { runMigrations } from "./migrate";
export { persistFinalSession, persistSession } from "./persist";
export type { MessageRecord, SessionRecord } from "./sessions";
export {
  generateId,
  generateSessionId,
  insertMessage,
  saveSessionWithMessages,
  updateSessionIncremental,
  upsertSession,
} from "./sessions";

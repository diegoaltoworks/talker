/**
 * Database Module
 *
 * Optional session persistence to Turso/libSQL.
 * Activates when database.url and database.authToken are provided in config.
 */

export { closeDbClient, getDbClient, initDbClient } from "./client";
export { runMigrations } from "./migrate";
export { persistFinalSession, persistSession } from "./persist";
export {
  generateId,
  generateSessionId,
  insertMessage,
  saveSessionWithMessages,
  updateSessionIncremental,
  upsertSession,
} from "./sessions";
export type { MessageRecord, SessionRecord } from "./sessions";

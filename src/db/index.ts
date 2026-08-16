/**
 * Database Module
 *
 * Optional session persistence via a `TalkerStore`. `resolveStore` picks
 * one for a mount: `TalkerConfig.store` if set, else a Turso/libSQL store
 * over `TalkerConfig.database` or (plugin mode) chatter's own connection,
 * else a no-op. See `TalkerDependencies.store` and `./resolve-store.ts`.
 */

export { closeDbClient, getDbClient, initDbClient } from "./client";
export { createLibsqlTalkerStore } from "./libsql-store";
export { runMigrations } from "./migrate";
export { persistFinalSession, persistSession } from "./persist";
export { resolveStore } from "./resolve-store";
export type { MessageRecord, MessageStatusRecord, SessionRecord, TalkerStore } from "./store";
export { createNullTalkerStore, generateId, generateSessionId } from "./store";

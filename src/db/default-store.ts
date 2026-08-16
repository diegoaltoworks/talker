/**
 * The store a caller falls back to when it doesn't have (or wasn't passed) a
 * `TalkerDependencies.store` - wraps whatever `initDbClient`/`setDbClient`
 * last configured on the legacy singleton client, or a no-op when nothing
 * has. Resolved fresh on every call, since the singleton can change between
 * calls (tests toggle it with `setDbClient`).
 *
 * Only `db/persist.ts` and `db/sessions.ts`'s deprecated no-deps exports use
 * this - route handlers that have a `TalkerDependencies` in hand pass
 * `deps.store` explicitly instead.
 */

import { getDbClient } from "./client";
import { createLibsqlTalkerStore } from "./libsql-store";
import { createNullTalkerStore, type TalkerStore } from "./store";

export function resolveDefaultStore(): TalkerStore {
  const client = getDbClient();
  return client ? createLibsqlTalkerStore(client) : createNullTalkerStore();
}

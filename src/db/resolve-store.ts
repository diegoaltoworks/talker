/**
 * Resolves the `TalkerStore` a mount uses, in priority order:
 *
 * 1. `config.store` - bring-your-own. No migrations run; the host owns its
 *    own schema.
 * 2. `config.database` - talker's own explicit Turso/libSQL connection, via
 *    the legacy singleton client (`initDbClient` only dials once - a second
 *    mount with a *different* `database` config in the same process reuses
 *    the first mount's connection rather than opening its own).
 * 3. `liveClient` - a connection to reuse (chatter's `deps.db` in plugin
 *    mode) instead of opening a second connection to the same database. This
 *    is the fix for the historical bug where plugin mode always dialed its
 *    own connection even when chatter's was already live.
 * 4. A no-op store - every write resolves `false`, no I/O.
 */

import type { Client } from "@libsql/client";
import type { TalkerConfig } from "../types";
import { getDbClient, initDbClient } from "./client";
import { createLibsqlTalkerStore } from "./libsql-store";
import { runMigrations } from "./migrate";
import { createNullTalkerStore, type TalkerStore } from "./store";

export async function resolveStore(
  config: TalkerConfig,
  liveClient?: Client,
): Promise<TalkerStore> {
  if (config.store) return config.store;

  if (config.database?.url && config.database?.authToken) {
    await initDbClient(config.database.url, config.database.authToken);
    const client = getDbClient();
    if (!client) return createNullTalkerStore();
    await runMigrations(client);
    return createLibsqlTalkerStore(client);
  }

  if (liveClient) {
    await runMigrations(liveClient);
    return createLibsqlTalkerStore(liveClient);
  }

  return createNullTalkerStore();
}

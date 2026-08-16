/**
 * Cleanup Defaults
 *
 * Shared between plugin.ts (chatter plugin mode) and standalone.ts
 * (standalone server mode), which each wire up the same context/pending-query
 * cleanup sweep and must agree on its defaults.
 */

export const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_PENDING_QUERY_TTL_MS = 60 * 1000; // 1 minute

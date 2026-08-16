/**
 * Shared Defaults
 *
 * Constants used by more than one module, single-sourced here so they can't
 * drift apart. Cleanup defaults are shared between plugin.ts (chatter plugin
 * mode) and standalone.ts (standalone server mode), which each wire up the
 * same context/pending-query cleanup sweep and must agree on its defaults.
 */

export const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_PENDING_QUERY_TTL_MS = 60 * 1000; // 1 minute

/**
 * OpenAI model for the incoming/outgoing processing pipeline when
 * `processing.model` is not configured. Shared between plugin.ts and
 * standalone.ts, which both resolve `openaiModel` the same way.
 */
export const DEFAULT_PROCESSING_MODEL = "gpt-4o-mini";

/**
 * Sentinel used across every channel handler when Twilio's webhook payload
 * omits `From` (malformed or replayed request). Also the value `redactPhone`
 * (see `./logger`) passes through unredacted, since it carries no PII.
 */
export const UNKNOWN_PHONE_NUMBER = "unknown";

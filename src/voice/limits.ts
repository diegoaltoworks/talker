/**
 * Daily spend guards for voice — per-number and global caps.
 *
 * Framework-free and storage-free: the host supplies a `VoiceLimitsStore`
 * implementation against whatever database it already runs, so this module
 * needs no DB client and talker takes on no new dependency. The store type is
 * structural, so any object with a matching `incrementAndGet` satisfies it.
 *
 * One shared counter covers a whole voice round-trip: a caller reserves once,
 * before transcription starts, so transcribe + reply cost a single unit.
 */

import { logger } from "../core/logger";

export interface VoiceLimitsConfig {
  perNumberDailyLimit: number;
  globalDailyLimit: number;
}

/** The key used for the global counter — there is no per-number key at that scope. */
export const GLOBAL_LIMIT_KEY = "global";

export const DEFAULT_PER_NUMBER_DAILY_LIMIT = 100;
export const DEFAULT_GLOBAL_DAILY_LIMIT = 500;

/** The environment variables this module understands, all optional. */
export interface VoiceLimitsEnv {
  VOICE_LIMIT_PER_NUMBER?: string;
  VOICE_LIMIT_GLOBAL?: string;
}

/** Which cap blocked the request, or null when it is allowed. */
export type VoiceLimitReason = "per-number" | "global" | null;

export interface VoiceLimitCheck {
  allowed: boolean;
  reason: VoiceLimitReason;
}

/**
 * Structural dependency — a host implements this against its own storage.
 *
 * Must increment and read back atomically. A deployment running more than one
 * instance would race a read-then-write from this process against another's.
 */
export interface VoiceLimitsStore {
  /** Increments the counter for (scope, key, day) and returns the count after incrementing. */
  incrementAndGet(scope: "number" | "global", key: string, day: string): Promise<number>;
}

export interface VoiceLimiterDeps {
  store: VoiceLimitsStore;
  /** Clock, injectable so day-rollover tests do not depend on real time. */
  now?: () => number;
}

export interface VoiceLimiter {
  /**
   * Reserves one unit for `phoneNumber`, subject to both daily caps.
   *
   * Call this exactly once per logical request: the increment is permanent and
   * unconditional (there is no release path), so a duplicate call — or a retry
   * after a transient failure — permanently burns a second unit of quota for
   * one request never delivered. Blocked calls still count: a call that trips
   * the per-number cap still consumes one of that number's daily units, and
   * (by design, see below) a call that trips the global cap after passing the
   * per-number check also consumes one of that number's units, for nothing.
   *
   * The per-number counter increments before the global one, so a number
   * blocked at its own cap never touches the shared global budget. The mirror
   * case is accepted, not fixed: once the global cap is exhausted for the day,
   * every further caller still burns one of their own per-number units on the
   * way to being told no. This favors the more common cost risk (one number
   * hammering the endpoint) over the rarer one (the global cap saturating and
   * clipping everyone's personal quota).
   */
  checkAndReserve(phoneNumber: string): Promise<VoiceLimitCheck>;
}

/** The UTC calendar day counters roll over on, e.g. "2026-08-01". */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A configured non-negative integer wins over the default; anything else falls back. */
export function pickDailyLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Resolve limits from an environment-shaped object plus explicit overrides.
 *
 * The env object is passed in rather than read from `process.env`, keeping
 * this module free of ambient state; a host that wants env-driven limits calls
 * `resolveVoiceLimitsConfig(process.env)` itself.
 */
export function resolveVoiceLimitsConfig(
  env: VoiceLimitsEnv = {},
  overrides: Partial<VoiceLimitsConfig> = {},
): VoiceLimitsConfig {
  return {
    perNumberDailyLimit:
      overrides.perNumberDailyLimit ??
      pickDailyLimit(env.VOICE_LIMIT_PER_NUMBER, DEFAULT_PER_NUMBER_DAILY_LIMIT),
    globalDailyLimit:
      overrides.globalDailyLimit ??
      pickDailyLimit(env.VOICE_LIMIT_GLOBAL, DEFAULT_GLOBAL_DAILY_LIMIT),
  };
}

/**
 * Build a limiter. Call `checkAndReserve` exactly once per inbound voice note,
 * BEFORE transcription starts, so a single unit covers transcribe + reply.
 */
export function createVoiceLimiter(
  config: VoiceLimitsConfig,
  deps: VoiceLimiterDeps,
): VoiceLimiter {
  const now = deps.now ?? Date.now;

  return {
    async checkAndReserve(phoneNumber: string): Promise<VoiceLimitCheck> {
      const day = utcDayKey(now());

      const perNumberCount = await deps.store.incrementAndGet("number", phoneNumber, day);
      if (perNumberCount > config.perNumberDailyLimit) {
        logger.warn("voice: per-number daily limit reached", { phoneNumber, day });
        return { allowed: false, reason: "per-number" };
      }

      const globalCount = await deps.store.incrementAndGet("global", GLOBAL_LIMIT_KEY, day);
      if (globalCount > config.globalDailyLimit) {
        logger.warn("voice: global daily limit reached", { day });
        return { allowed: false, reason: "global" };
      }

      return { allowed: true, reason: null };
    },
  };
}

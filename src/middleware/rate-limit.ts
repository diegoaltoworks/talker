/**
 * Rate Limiting Middleware
 *
 * Sliding-window rate limiter keyed by caller phone number.
 * Prevents abuse by limiting requests per phone number within a time window.
 */

import type { Context, Next } from "hono";
import { logger } from "../core/logger";

const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic cleanup of stale entries
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(windowMs: number): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs * 2;
    for (const [key, entry] of rateLimitStore) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, windowMs);
}

/**
 * Check if a phone number has exceeded the rate limit.
 * Returns true if the request should be allowed.
 */
export function checkRateLimit(
  phoneNumber: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = rateLimitStore.get(phoneNumber);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(phoneNumber, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    return false;
  }

  entry.timestamps.push(now);
  return true;
}

/**
 * Hono middleware factory for rate limiting.
 *
 * Limits requests per phone number (from body.From).
 * Returns a 429 TwiML response when the limit is exceeded.
 */
export function rateLimitMiddleware(config?: { maxRequests?: number; windowMs?: number }) {
  const maxRequests = config?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;

  ensureCleanup(windowMs);

  return async (c: Context, next: Next) => {
    const body = await c.req.parseBody();
    const phoneNumber = ((body.From as string) || "unknown").trim();

    if (!checkRateLimit(phoneNumber, maxRequests, windowMs)) {
      logger.warn("rate limit exceeded", { phoneNumber, path: c.req.path });
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Please try again in a moment.</Say>
</Response>`;
      return c.text(twiml, 429, { "Content-Type": "text/xml" });
    }

    return next();
  };
}

/**
 * Reset rate limit store (for testing)
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

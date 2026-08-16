/**
 * Input Sanitization Middleware
 *
 * Enforces a maximum length on user-supplied input fields (SpeechResult, Body).
 * Truncates silently rather than rejecting, since Twilio expects a TwiML response.
 */

import type { Context, Next } from "hono";
import { logger } from "../core/logger";
import { truncateGraphemeSafe } from "../core/text";

const DEFAULT_MAX_INPUT_LENGTH = 1000;

type ParsedBody = Awaited<ReturnType<Context["req"]["parseBody"]>>;

/**
 * Hono middleware factory for input sanitization.
 *
 * Intercepts the request body and truncates SpeechResult and Body fields
 * to the configured maximum length. Stores the sanitized values on the
 * context so downstream handlers see the truncated values.
 *
 * Handlers must read the body via `getSanitizedBody(c)` rather than calling
 * `c.req.parseBody()` again - Hono re-parses the raw form data fresh on
 * every call, which would silently discard the truncation done here.
 */
export function inputSanitizeMiddleware(maxInputLength?: number) {
  const maxLen = maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;

  return async (c: Context, next: Next) => {
    const body = await c.req.parseBody();

    if (typeof body.SpeechResult === "string" && body.SpeechResult.length > maxLen) {
      logger.warn("input truncated: SpeechResult", {
        original: body.SpeechResult.length,
        max: maxLen,
      });
      body.SpeechResult = truncateGraphemeSafe(body.SpeechResult, maxLen);
    }

    if (typeof body.Body === "string" && body.Body.length > maxLen) {
      logger.warn("input truncated: Body", {
        original: body.Body.length,
        max: maxLen,
      });
      body.Body = truncateGraphemeSafe(body.Body, maxLen);
    }

    c.set("sanitizedBody", body);

    return next();
  };
}

/**
 * Read the parsed request body, preferring the sanitized copy stored by
 * `inputSanitizeMiddleware` so truncation isn't lost to a second, fresh
 * `c.req.parseBody()` parse. Falls back to parsing directly when the
 * middleware hasn't run (e.g. routes without it, or in tests).
 */
export async function getSanitizedBody(c: Context): Promise<ParsedBody> {
  const cached = c.get("sanitizedBody") as ParsedBody | undefined;
  if (cached) return cached;
  return c.req.parseBody();
}

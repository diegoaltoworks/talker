/**
 * Input Truncation Middleware
 *
 * Enforces a maximum length on user-supplied input fields (SpeechResult, Body).
 * Truncates silently rather than rejecting, since Twilio expects a TwiML response.
 * Length truncation only - no content validation or filtering; see
 * `truncateInputMiddleware`'s doc comment.
 */

import type { Context, Next } from "hono";
import { logger } from "../core/logger";
import { truncateGraphemeSafe } from "../core/text";

const DEFAULT_MAX_INPUT_LENGTH = 1000;

type ParsedBody = Awaited<ReturnType<Context["req"]["parseBody"]>>;

/**
 * Hono middleware factory that truncates user-supplied input.
 *
 * Intercepts the request body and truncates SpeechResult and Body fields
 * to the configured maximum length. Stores the truncated values on the
 * context so downstream handlers see them. Truncation only: nothing here
 * validates, filters, or rejects content - the name says what it does.
 *
 * Handlers must read the body via `getTruncatedBody(c)` rather than calling
 * `c.req.parseBody()` again - Hono re-parses the raw form data fresh on
 * every call, which would silently discard the truncation done here.
 */
export function truncateInputMiddleware(maxInputLength?: number) {
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

    c.set("truncatedBody", body);

    return next();
  };
}

/**
 * Read the parsed request body, preferring the truncated copy stored by
 * `truncateInputMiddleware` so truncation isn't lost to a second, fresh
 * `c.req.parseBody()` parse. Falls back to parsing directly when the
 * middleware hasn't run (e.g. routes without it, or in tests).
 */
export async function getTruncatedBody(c: Context): Promise<ParsedBody> {
  const cached = c.get("truncatedBody") as ParsedBody | undefined;
  if (cached) return cached;
  return c.req.parseBody();
}

/**
 * @deprecated Removed in 1.0.0. Use `truncateInputMiddleware` - this only
 * truncates, it never validates or filters content, and the name claimed
 * otherwise.
 */
export const inputSanitizeMiddleware = truncateInputMiddleware;

/**
 * Input Sanitization Middleware
 *
 * Enforces a maximum length on user-supplied input fields (SpeechResult, Body).
 * Truncates silently rather than rejecting, since Twilio expects a TwiML response.
 */

import type { Context, Next } from "hono";
import { logger } from "../core/logger";

const DEFAULT_MAX_INPUT_LENGTH = 1000;

// Constructing an Intl.Segmenter isn't free (it loads ICU grapheme-break
// data) - shared across calls rather than rebuilt per truncateInput call.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Truncate a string to the max length, grapheme-cluster-safe.
 *
 * A plain `substring(0, maxLength)` counts UTF-16 code units, so a cut that
 * lands inside a surrogate pair (any character outside the Basic Multilingual
 * Plane - most emoji) or between a base character and a combining mark
 * leaves a lone surrogate or an orphaned combining character at the end of
 * the string. A lone surrogate is invalid in XML content and reaches TwiML
 * broken; either way playback/display is corrupted. Segmenting by grapheme
 * cluster and only ever dropping a whole cluster avoids both. The result may
 * end up a little shorter than `maxLength` when the boundary cluster doesn't
 * fit - that's the max being honoured, not a bug.
 */
export function truncateInput(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  let result = "";
  for (const { segment } of GRAPHEME_SEGMENTER.segment(input)) {
    if (result.length + segment.length > maxLength) break;
    result += segment;
  }
  return result;
}

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
      body.SpeechResult = truncateInput(body.SpeechResult, maxLen);
    }

    if (typeof body.Body === "string" && body.Body.length > maxLen) {
      logger.warn("input truncated: Body", {
        original: body.Body.length,
        max: maxLen,
      });
      body.Body = truncateInput(body.Body, maxLen);
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

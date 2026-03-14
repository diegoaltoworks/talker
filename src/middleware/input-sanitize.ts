/**
 * Input Sanitization Middleware
 *
 * Enforces a maximum length on user-supplied input fields (SpeechResult, Body).
 * Truncates silently rather than rejecting, since Twilio expects a TwiML response.
 */

import type { Context, Next } from "hono";
import { logger } from "../core/logger";

const DEFAULT_MAX_INPUT_LENGTH = 1000;

/**
 * Truncate a string to the max length, appending an ellipsis if truncated.
 */
export function truncateInput(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.substring(0, maxLength);
}

/**
 * Hono middleware factory for input sanitization.
 *
 * Intercepts the request body and truncates SpeechResult and Body fields
 * to the configured maximum length. Stores the sanitized values on the
 * context so downstream handlers see the truncated values.
 */
export function inputSanitizeMiddleware(maxInputLength?: number) {
  const maxLen = maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;

  return async (c: Context, next: Next) => {
    const body = await c.req.parseBody();

    let truncated = false;
    if (typeof body.SpeechResult === "string" && body.SpeechResult.length > maxLen) {
      logger.warn("input truncated: SpeechResult", {
        original: body.SpeechResult.length,
        max: maxLen,
      });
      body.SpeechResult = truncateInput(body.SpeechResult, maxLen);
      truncated = true;
    }

    if (typeof body.Body === "string" && body.Body.length > maxLen) {
      logger.warn("input truncated: Body", {
        original: body.Body.length,
        max: maxLen,
      });
      body.Body = truncateInput(body.Body, maxLen);
      truncated = true;
    }

    if (truncated) {
      // Store sanitized body on context for downstream handlers
      c.set("sanitizedBody", body);
    }

    return next();
  };
}

/**
 * Twilio Webhook Signature Validation Middleware
 *
 * Validates that incoming requests are genuinely from Twilio by verifying
 * the X-Twilio-Signature header using HMAC-SHA1 per Twilio's spec.
 *
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */

import { createHmac } from "node:crypto";
import type { Context, Next } from "hono";
import { logger } from "../core/logger";

/**
 * Compute the expected Twilio signature for a request.
 *
 * Algorithm (per Twilio docs):
 * 1. Take the full URL of the request
 * 2. Sort POST body params alphabetically by key
 * 3. Append each key-value pair to the URL (no separators)
 * 4. HMAC-SHA1 the result with the auth token, then Base64 encode
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac("sha1", authToken).update(data).digest("base64");
}

/**
 * Validate a Twilio request signature
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const expected = computeTwilioSignature(authToken, url, params);

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Hono middleware factory for Twilio signature validation.
 *
 * When authToken is provided, rejects any request without a valid
 * X-Twilio-Signature header. When authToken is not configured,
 * the middleware is a pass-through (allows development/testing without Twilio).
 */
export function twilioSignatureMiddleware(authToken?: string, baseUrl?: string) {
  return async (c: Context, next: Next) => {
    if (!authToken) {
      return next();
    }

    const signature = c.req.header("x-twilio-signature");
    if (!signature) {
      logger.warn("rejected request: missing X-Twilio-Signature header", {
        path: c.req.path,
      });
      return c.text("", 403);
    }

    // Build the full URL Twilio used to compute its signature
    const requestUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}${c.req.path}` : c.req.url;

    // Parse the POST body params for signature computation
    const body = await c.req.parseBody();
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        params[key] = value;
      }
    }

    if (!validateTwilioSignature(authToken, signature, requestUrl, params)) {
      logger.warn("rejected request: invalid Twilio signature", {
        path: c.req.path,
      });
      return c.text("", 403);
    }

    return next();
  };
}

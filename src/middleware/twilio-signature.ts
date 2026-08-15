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
 * Options for {@link twilioSignatureMiddleware}.
 */
export interface TwilioSignatureOptions {
  /**
   * Accept requests when no auth token is configured, i.e. run with signature
   * validation switched off. Development and local testing only — with this on,
   * anyone who can reach the webhook can impersonate Twilio. Default: false.
   */
  allowUnsigned?: boolean;
}

/**
 * Build the URL Twilio used when it computed its signature.
 *
 * Twilio signs the full request URL *including* the query string, so a
 * webhook configured with query parameters (`/sms?tenant=acme`) only
 * validates when they are preserved here.
 */
export function signedRequestUrl(requestUrl: string, path: string, baseUrl?: string): string {
  if (!baseUrl) return requestUrl;
  const queryIndex = requestUrl.indexOf("?");
  const query = queryIndex === -1 ? "" : requestUrl.slice(queryIndex);
  return `${baseUrl.replace(/\/$/, "")}${path}${query}`;
}

/**
 * Hono middleware factory for Twilio signature validation.
 *
 * Fails closed: without an auth token there is no way to tell a genuine Twilio
 * request from a forged one, so every request is rejected with 403 unless
 * `allowUnsigned` is explicitly set.
 */
export function twilioSignatureMiddleware(
  authToken?: string,
  baseUrl?: string,
  options: TwilioSignatureOptions = {},
) {
  return async (c: Context, next: Next) => {
    if (!authToken) {
      if (options.allowUnsigned) {
        return next();
      }
      logger.warn("rejected request: no Twilio auth token configured to validate the signature", {
        path: c.req.path,
      });
      return c.text("", 403);
    }

    const signature = c.req.header("x-twilio-signature");
    if (!signature) {
      logger.warn("rejected request: missing X-Twilio-Signature header", {
        path: c.req.path,
      });
      return c.text("", 403);
    }

    const requestUrl = signedRequestUrl(c.req.url, c.req.path, baseUrl);

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

/**
 * Webhook Security Policy
 *
 * Startup-time counterpart to the per-request Twilio signature middleware.
 * Signature validation needs the Twilio auth token; without it the webhooks
 * cannot tell Twilio from anyone else who can reach them. Rather than mount
 * routes that quietly reject (or worse, quietly accept) every request, decide
 * once, loudly, at mount time.
 */

import type { TalkerConfig } from "../types";
import { logger } from "./logger";

const MISSING_TOKEN_MESSAGE =
  "Twilio auth token missing: webhook signatures cannot be validated. " +
  "Set twilio.authToken, or set allowUnsignedWebhooks: true to mount webhooks " +
  "without signature validation (development only).";

/**
 * Assert that telephony webhooks may be mounted.
 *
 * Throws when no auth token is configured, unless the host has explicitly
 * opted into unsigned webhooks — in which case it warns instead, because an
 * unsigned deployment should never be a silent one.
 */
export function assertWebhookSecurity(config: TalkerConfig): void {
  if (config.twilio?.authToken) return;

  if (!config.allowUnsignedWebhooks) {
    throw new Error(MISSING_TOKEN_MESSAGE);
  }

  logger.warn(
    "INSECURE: mounting telephony webhooks without Twilio signature validation " +
      "(allowUnsignedWebhooks is enabled). Anyone who can reach these endpoints can " +
      "impersonate Twilio. Do not enable this in production.",
  );
}

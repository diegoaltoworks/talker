/**
 * Messaging Routes
 *
 * Hono route factory shared by SMS and WhatsApp — Twilio uses the same
 * TwiML response format and webhook payload shape for both.
 *
 * Endpoints (channel is "sms" or "whatsapp"):
 * - POST /<channel>          — Incoming message webhook
 * - POST /<channel>/fallback — Fallback when incoming URL fails
 * - POST /<channel>/status   — Message delivery status callback
 * - GET  /<channel>          — Health check
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import { truncateInputMiddleware } from "../../middleware/input-sanitize";
import { rateLimitMiddleware } from "../../middleware/rate-limit";
import { twilioSignatureMiddleware } from "../../middleware/twilio-signature";
import type { TalkerDependencies } from "../../types";
import { handleFallback } from "../shared/handle-fallback";
import { handleStatusCallback } from "../shared/handle-status-callback";
import { handleIncomingMessage } from "./handle-incoming";
import type { MessagingChannel } from "./processor";

const HEALTH_CHECK_LABEL: Record<MessagingChannel, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
};

/**
 * Create routes for a messaging channel (SMS or WhatsApp)
 */
export function messagingRoutes(
  deps: TalkerDependencies,
  registry: FlowRegistry,
  channel: MessagingChannel,
) {
  const app = new Hono();
  const path = `/${channel}`;
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;
  const signatureOptions = { allowUnsigned: deps.config.allowUnsignedWebhooks };

  // Security middleware stack for all POST endpoints
  app.post(path, twilioSignatureMiddleware(authToken, baseUrl, signatureOptions));
  app.post(path, rateLimitMiddleware(deps.config.rateLimit, deps.config));
  app.post(path, truncateInputMiddleware(deps.config.maxInputLength));

  app.post(`${path}/fallback`, twilioSignatureMiddleware(authToken, baseUrl, signatureOptions));
  app.post(`${path}/fallback`, rateLimitMiddleware(deps.config.rateLimit, deps.config));
  app.post(`${path}/fallback`, truncateInputMiddleware(deps.config.maxInputLength));

  app.post(`${path}/status`, twilioSignatureMiddleware(authToken, baseUrl, signatureOptions));

  // Incoming message webhook
  app.post(path, (c) => handleIncomingMessage(c, deps, registry, channel));

  // Fallback webhook — called when the incoming URL fails
  app.post(`${path}/fallback`, (c) => handleFallback(c, deps, channel));

  // Status callback — delivery status updates (sent, delivered, [read,] failed)
  app.post(`${path}/status`, (c) => handleStatusCallback(c, deps, channel));

  // Health check
  app.get(path, (c) => c.text(`${HEALTH_CHECK_LABEL[channel]} endpoint active`));

  return app;
}

/** @deprecated Use `messagingRoutes(deps, registry, "sms")`. */
export function smsRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  return messagingRoutes(deps, registry, "sms");
}

/** @deprecated Use `messagingRoutes(deps, registry, "whatsapp")`. */
export function whatsappRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  return messagingRoutes(deps, registry, "whatsapp");
}

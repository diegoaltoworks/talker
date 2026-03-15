/**
 * SMS Routes
 *
 * Hono route factory for SMS webhooks.
 *
 * Endpoints:
 * - POST /sms         — Incoming message webhook
 * - POST /sms/fallback — Fallback when incoming URL fails
 * - POST /sms/status   — Message delivery status callback
 * - GET  /sms          — Health check
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import { inputSanitizeMiddleware } from "../../middleware/input-sanitize";
import { rateLimitMiddleware } from "../../middleware/rate-limit";
import { twilioSignatureMiddleware } from "../../middleware/twilio-signature";
import type { TalkerDependencies } from "../../types";
import { handleFallback } from "../shared/handle-fallback";
import { handleStatusCallback } from "../shared/handle-status-callback";
import { handleIncomingSMS } from "./handle-incoming";

/**
 * Create SMS routes
 */
export function smsRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;

  // Security middleware stack for all SMS POST endpoints
  app.post("/sms", twilioSignatureMiddleware(authToken, baseUrl));
  app.post("/sms", rateLimitMiddleware(deps.config.rateLimit));
  app.post("/sms", inputSanitizeMiddleware(deps.config.maxInputLength));

  app.post("/sms/fallback", twilioSignatureMiddleware(authToken, baseUrl));
  app.post("/sms/fallback", rateLimitMiddleware(deps.config.rateLimit));
  app.post("/sms/fallback", inputSanitizeMiddleware(deps.config.maxInputLength));

  app.post("/sms/status", twilioSignatureMiddleware(authToken, baseUrl));

  // Incoming message webhook
  app.post("/sms", (c) => handleIncomingSMS(c, deps, registry));

  // Fallback webhook — called when the incoming URL fails
  app.post("/sms/fallback", (c) => handleFallback(c, deps, "sms"));

  // Status callback — delivery status updates (sent, delivered, failed)
  app.post("/sms/status", (c) => handleStatusCallback(c, deps, "sms"));

  // Health check
  app.get("/sms", (c) => c.text("SMS endpoint active"));

  return app;
}

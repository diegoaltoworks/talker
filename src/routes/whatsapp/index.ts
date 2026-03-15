/**
 * WhatsApp Routes
 *
 * Hono route factory for WhatsApp webhooks.
 * Twilio uses the same TwiML response format for WhatsApp as it does for SMS.
 *
 * Endpoints:
 * - POST /whatsapp         — Incoming message webhook
 * - POST /whatsapp/fallback — Fallback when incoming URL fails
 * - POST /whatsapp/status   — Message delivery status callback
 * - GET  /whatsapp          — Health check
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import { inputSanitizeMiddleware } from "../../middleware/input-sanitize";
import { rateLimitMiddleware } from "../../middleware/rate-limit";
import { twilioSignatureMiddleware } from "../../middleware/twilio-signature";
import type { TalkerDependencies } from "../../types";
import { handleFallback } from "../shared/handle-fallback";
import { handleStatusCallback } from "../shared/handle-status-callback";
import { handleIncomingWhatsApp } from "./handle-incoming";

/**
 * Create WhatsApp routes
 */
export function whatsappRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;

  // Security middleware stack for all WhatsApp POST endpoints
  app.post("/whatsapp", twilioSignatureMiddleware(authToken, baseUrl));
  app.post("/whatsapp", rateLimitMiddleware(deps.config.rateLimit));
  app.post("/whatsapp", inputSanitizeMiddleware(deps.config.maxInputLength));

  app.post("/whatsapp/fallback", twilioSignatureMiddleware(authToken, baseUrl));
  app.post("/whatsapp/fallback", rateLimitMiddleware(deps.config.rateLimit));
  app.post("/whatsapp/fallback", inputSanitizeMiddleware(deps.config.maxInputLength));

  app.post("/whatsapp/status", twilioSignatureMiddleware(authToken, baseUrl));

  // Incoming message webhook
  app.post("/whatsapp", (c) => handleIncomingWhatsApp(c, deps, registry));

  // Fallback webhook — called when the incoming URL fails
  app.post("/whatsapp/fallback", (c) => handleFallback(c, deps, "whatsapp"));

  // Status callback — delivery status updates (sent, delivered, read, failed)
  app.post("/whatsapp/status", (c) => handleStatusCallback(c, deps, "whatsapp"));

  // Health check
  app.get("/whatsapp", (c) => c.text("WhatsApp endpoint active"));

  return app;
}

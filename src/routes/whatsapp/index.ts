/**
 * WhatsApp Routes
 *
 * Hono route factory for WhatsApp webhooks.
 * Twilio uses the same TwiML response format for WhatsApp as it does for SMS.
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import { inputSanitizeMiddleware } from "../../middleware/input-sanitize";
import { rateLimitMiddleware } from "../../middleware/rate-limit";
import { twilioSignatureMiddleware } from "../../middleware/twilio-signature";
import type { TalkerDependencies } from "../../types";
import { handleIncomingWhatsApp } from "./handle-incoming";

/**
 * Create WhatsApp routes
 */
export function whatsappRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;

  // Security middleware stack (POST only — GET health check is public)
  app.post("/whatsapp", twilioSignatureMiddleware(authToken, baseUrl));
  app.post("/whatsapp", rateLimitMiddleware(deps.config.rateLimit));
  app.post("/whatsapp", inputSanitizeMiddleware(deps.config.maxInputLength));

  app.post("/whatsapp", (c) => handleIncomingWhatsApp(c, deps, registry));
  app.get("/whatsapp", (c) => c.text("WhatsApp endpoint active"));

  return app;
}

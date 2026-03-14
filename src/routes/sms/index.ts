/**
 * SMS Routes
 *
 * Hono route factory for SMS webhooks.
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import { inputSanitizeMiddleware } from "../../middleware/input-sanitize";
import { rateLimitMiddleware } from "../../middleware/rate-limit";
import { twilioSignatureMiddleware } from "../../middleware/twilio-signature";
import type { TalkerDependencies } from "../../types";
import { handleIncomingSMS } from "./handle-incoming";

/**
 * Create SMS routes
 */
export function smsRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();

  // Security middleware stack (POST only — GET health check is public)
  app.post("/sms", twilioSignatureMiddleware(deps.config.twilio?.authToken));
  app.post("/sms", rateLimitMiddleware(deps.config.rateLimit));
  app.post("/sms", inputSanitizeMiddleware(deps.config.maxInputLength));

  app.post("/sms", (c) => handleIncomingSMS(c, deps, registry));
  app.get("/sms", (c) => c.text("SMS endpoint active"));

  return app;
}

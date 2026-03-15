/**
 * WhatsApp Routes
 *
 * Hono route factory for WhatsApp webhooks.
 * Twilio uses the same TwiML response format for WhatsApp as it does for SMS.
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { handleIncomingWhatsApp } from "./handle-incoming";

/**
 * Create WhatsApp routes
 */
export function whatsappRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();

  app.post("/whatsapp", (c) => handleIncomingWhatsApp(c, deps, registry));
  app.get("/whatsapp", (c) => c.text("WhatsApp endpoint active"));

  return app;
}

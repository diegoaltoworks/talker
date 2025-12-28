/**
 * SMS Routes
 *
 * Hono route factory for SMS webhooks.
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { handleIncomingSMS } from "./handle-incoming";

/**
 * Create SMS routes
 */
export function smsRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();

  app.post("/sms", (c) => handleIncomingSMS(c, deps, registry));
  app.get("/sms", (c) => c.text("SMS endpoint active"));

  return app;
}

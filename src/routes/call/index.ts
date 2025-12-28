/**
 * Call Routes
 *
 * Hono route factory for voice call webhooks.
 * Mounts individual handlers for each call lifecycle event.
 */

import { Hono } from "hono";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { handleAnswer } from "./handle-answer";
import { handleInitialCall } from "./handle-initial";
import { handleNoSpeech } from "./handle-nospeech";
import { handleRespond } from "./handle-respond";
import { handleStatus } from "./handle-status";

/**
 * Create call routes
 */
export function callRoutes(deps: TalkerDependencies, registry: FlowRegistry) {
  const app = new Hono();

  app.post("/call", (c) => handleInitialCall(c, deps.config));
  app.post("/call/respond", (c) => handleRespond(c, deps, registry));
  app.post("/call/answer", (c) => handleAnswer(c, deps.config));
  app.post("/call/no-speech", (c) => handleNoSpeech(c, deps.config));
  app.post("/call/status", (c) => handleStatus(c));

  return app;
}

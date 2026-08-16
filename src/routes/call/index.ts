/**
 * Call Routes
 *
 * Hono route factory for voice call webhooks.
 * Mounts individual handlers for each call lifecycle event.
 */

import { Hono } from "hono";
import {
  CALL_ANSWER_PATH,
  CALL_NO_SPEECH_PATH,
  CALL_PATH,
  CALL_RESPOND_PATH,
  CALL_STATUS_PATH,
} from "../../core/call-paths";
import type { FlowRegistry } from "../../flows/registry";
import { truncateInputMiddleware } from "../../middleware/input-sanitize";
import { rateLimitMiddleware } from "../../middleware/rate-limit";
import { twilioSignatureMiddleware } from "../../middleware/twilio-signature";
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
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;
  const signatureOptions = { allowUnsigned: deps.config.allowUnsignedWebhooks };

  // Security middleware stack. "/call/*" also matches the bare "/call" path,
  // so this alone covers every route registered below.
  app.use("/call/*", twilioSignatureMiddleware(authToken, baseUrl, signatureOptions));
  app.use("/call/*", rateLimitMiddleware(deps.config.rateLimit, deps.config));
  app.use("/call/*", truncateInputMiddleware(deps.config.maxInputLength));

  app.post(CALL_PATH, (c) => handleInitialCall(c, deps.config));
  app.post(CALL_RESPOND_PATH, (c) => handleRespond(c, deps, registry));
  app.post(CALL_ANSWER_PATH, (c) => handleAnswer(c, deps.config));
  app.post(CALL_NO_SPEECH_PATH, (c) => handleNoSpeech(c, deps.config));
  app.post(CALL_STATUS_PATH, (c) => handleStatus(c, deps));

  return app;
}

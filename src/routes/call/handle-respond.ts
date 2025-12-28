/**
 * Speech Response Handler
 *
 * Handles POST /call/respond — called by Twilio when speech is detected.
 * Supports both synchronous and async acknowledgment patterns.
 */

import type { Context } from "hono";
import { getMessageHistory, resetNoSpeechRetries } from "../../core/context";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../core/logger";
import { getPhrase } from "../../core/phrases";
import { acknowledgmentTwiml, gatherTwiml, sayTwiml } from "../../core/twiml";
import { persistSession } from "../../db/persist";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { setPending } from "./pending";
import { processCall } from "./processor";

export async function handleRespond(
  c: Context,
  deps: TalkerDependencies,
  registry: FlowRegistry,
): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const speechResult = body.SpeechResult as string;
  const config = deps.config;

  logger.info("speech received", { phoneNumber, speechResult });

  if (!speechResult) {
    const twiml = gatherTwiml(
      getPhrase("en", "didNotCatch", config.languageDir),
      "en",
      config,
      phoneNumber,
    );
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }

  resetNoSpeechRetries(phoneNumber);

  const messageHistory = getMessageHistory(phoneNumber);
  const isFirstMessage = messageHistory.filter((m) => m.role === "user").length === 0;
  const ackEnabled = config.features?.thinkingAcknowledgmentEnabled ?? false;

  // Async acknowledgment pattern for first message
  if (ackEnabled && isFirstMessage) {
    let resolveQuery: ((value: { twiml: string }) => void) | undefined;
    const promise = new Promise<{ twiml: string }>((resolve) => {
      resolveQuery = resolve;
    });

    setPending(phoneNumber, {
      speechResult,
      promise,
      resolve: resolveQuery as (value: { twiml: string }) => void,
    });

    processCall(deps, registry, phoneNumber, speechResult)
      .then((twiml) => {
        const pending = getPendingForResolve(phoneNumber);
        if (pending) pending.resolve({ twiml });
        persistSession(phoneNumber, "call");
      })
      .catch((error) => {
        logger.error("background processing error", {
          phoneNumber,
          error: getErrorMessage(error),
        });
        const pending = getPendingForResolve(phoneNumber);
        if (pending) {
          pending.resolve({
            twiml: sayTwiml(getPhrase("en", "error", config.languageDir), "en", config),
          });
        }
      });

    return c.text(acknowledgmentTwiml("en", config), 200, { "Content-Type": "text/xml" });
  }

  // Synchronous flow
  try {
    const twiml = await processCall(deps, registry, phoneNumber, speechResult);
    persistSession(phoneNumber, "call");
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("call processing error", { error: getErrorMessage(error) });
    const twiml = sayTwiml(getPhrase("en", "error", config.languageDir), "en", config);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }
}

// Lazy import to avoid circular dependency
function getPendingForResolve(phoneNumber: string) {
  // Re-import at call time
  const { getPending } = require("./pending");
  return getPending(phoneNumber);
}

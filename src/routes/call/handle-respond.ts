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
import { emitMessageTap } from "../../core/message-tap";
import { getPhrase } from "../../core/phrases";
import { acknowledgmentTwiml, gatherTwiml, sayTwiml } from "../../core/twiml";
import { persistSession } from "../../db/persist";
import type { FlowRegistry } from "../../flows/registry";
import { getSanitizedBody } from "../../middleware/input-sanitize";
import type { TalkerDependencies } from "../../types";
import { getPending, setPending } from "./pending";
import { processCall } from "./processor";

export async function handleRespond(
  c: Context,
  deps: TalkerDependencies,
  registry: FlowRegistry,
): Promise<Response> {
  const body = await getSanitizedBody(c);
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const to = (body.To as string) || "";
  const speechResult = body.SpeechResult as string;
  const config = deps.config;

  logger.info("speech received", { phoneNumber, speechResult });

  const tapOutbound = (text: string) =>
    emitMessageTap(config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body: text,
    });

  if (!speechResult) {
    const prompt = getPhrase("en", "didNotCatch", config.languageDir);
    tapOutbound(prompt);
    const twiml = gatherTwiml(prompt, "en", config, phoneNumber);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }

  emitMessageTap(config, {
    direction: "inbound",
    channel: "call",
    from: phoneNumber,
    to,
    body: speechResult,
  });

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

    processCall(deps, registry, phoneNumber, speechResult, to)
      .then((twiml) => {
        const pending = getPending(phoneNumber);
        if (pending) pending.resolve({ twiml });
        persistSession(phoneNumber, "call");
      })
      .catch((error) => {
        logger.error("background processing error", {
          phoneNumber,
          error: getErrorMessage(error),
        });
        const errorMessage = getPhrase("en", "error", config.languageDir);
        tapOutbound(errorMessage);
        const pending = getPending(phoneNumber);
        if (pending) {
          pending.resolve({
            twiml: sayTwiml(errorMessage, "en", config),
          });
        }
      });

    const ackMessage = getPhrase("en", "acknowledgment", config.languageDir);
    tapOutbound(ackMessage);
    return c.text(acknowledgmentTwiml("en", config, ackMessage), 200, {
      "Content-Type": "text/xml",
    });
  }

  // Synchronous flow
  try {
    const twiml = await processCall(deps, registry, phoneNumber, speechResult, to);
    persistSession(phoneNumber, "call");
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("call processing error", { error: getErrorMessage(error) });
    const errorMessage = getPhrase("en", "error", config.languageDir);
    tapOutbound(errorMessage);
    const twiml = sayTwiml(errorMessage, "en", config);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }
}

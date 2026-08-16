/**
 * Speech Response Handler
 *
 * Handles POST /call/respond — called by Twilio when speech is detected.
 * Supports both synchronous and async acknowledgment patterns.
 */

import type { Context } from "hono";
import { getMessageHistory, resetNoSpeechRetries, resolveLanguage } from "../../core/context";
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
    const language = resolveLanguage(phoneNumber);
    const prompt = getPhrase(language, "didNotCatch", config.languageDir);
    tapOutbound(prompt);
    const twiml = gatherTwiml(prompt, language, config, phoneNumber);
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
        // Resolved here rather than above: the failed turn may still have
        // detected a language before it threw, and this apology is the next
        // thing the caller hears.
        const errorLanguage = resolveLanguage(phoneNumber);
        const errorMessage = getPhrase(errorLanguage, "error", config.languageDir);
        tapOutbound(errorMessage);
        const pending = getPending(phoneNumber);
        if (pending) {
          pending.resolve({
            twiml: sayTwiml(errorMessage, errorLanguage, config),
          });
        }
      });

    // The acknowledgment is spoken before processing, so on a first turn
    // there is nothing detected yet and this is the default language. A
    // second acknowledged turn (a host that enables it beyond the first
    // message) picks up the language the caller has been speaking.
    const ackLanguage = resolveLanguage(phoneNumber);
    const ackMessage = getPhrase(ackLanguage, "acknowledgment", config.languageDir);
    tapOutbound(ackMessage);
    return c.text(acknowledgmentTwiml(ackLanguage, config, ackMessage), 200, {
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
    const language = resolveLanguage(phoneNumber);
    const errorMessage = getPhrase(language, "error", config.languageDir);
    tapOutbound(errorMessage);
    const twiml = sayTwiml(errorMessage, language, config);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }
}

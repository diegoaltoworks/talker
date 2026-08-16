/**
 * No-Speech Handler
 *
 * Handles POST /call/no-speech — called when Twilio detects silence.
 * Implements retry logic with configurable max retries.
 */

import type { Context } from "hono";
import { getLastPrompt, incrementNoSpeechRetries, resolveLanguage } from "../../core/context";
import { UNKNOWN_PHONE_NUMBER } from "../../core/defaults";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getPhrase } from "../../core/phrases";
import { gatherTwiml, sayTwiml, twimlResponse } from "../../core/twiml";
import type { TalkerConfig } from "../../types";

/** Maximum no-speech retries before a call ends, when `TalkerConfig.maxNoSpeechRetries` is not configured. */
export const DEFAULT_MAX_NO_SPEECH_RETRIES = 3;

export async function handleNoSpeech(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || UNKNOWN_PHONE_NUMBER).trim();
  const to = (body.To as string) || "";
  const maxRetries = config.maxNoSpeechRetries ?? DEFAULT_MAX_NO_SPEECH_RETRIES;

  const retryCount = incrementNoSpeechRetries(phoneNumber);
  const language = resolveLanguage(phoneNumber);

  if (retryCount > maxRetries) {
    logger.info("max retries reached, ending call", { phoneNumber, retryCount });
    const finalMessage = getPhrase(language, "didNotHearFinal", config.languageDir);
    emitMessageTap(config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body: finalMessage,
    });
    return twimlResponse(c, sayTwiml(finalMessage, language, config));
  }

  logger.info("retrying speech gather", { phoneNumber, retryCount, maxRetries });
  const retryMessage = getPhrase(language, "didNotHearRetry", config.languageDir);
  const lastPrompt = getLastPrompt(phoneNumber);

  let prompt: string;
  if (retryCount === 1) {
    prompt = lastPrompt ? `${retryMessage} ${lastPrompt}` : retryMessage;
  } else {
    prompt = lastPrompt || retryMessage;
  }

  emitMessageTap(config, {
    direction: "outbound",
    channel: "call",
    from: to,
    to: phoneNumber,
    body: prompt,
  });
  return twimlResponse(c, gatherTwiml(prompt, language, config, phoneNumber));
}

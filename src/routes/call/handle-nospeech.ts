/**
 * No-Speech Handler
 *
 * Handles POST /call/no-speech — called when Twilio detects silence.
 * Implements retry logic with configurable max retries.
 */

import type { Context } from "hono";
import { getDetectedLanguage, getLastPrompt, incrementNoSpeechRetries } from "../../core/context";
import { logger } from "../../core/logger";
import { getPhrase } from "../../core/phrases";
import { gatherTwiml, sayTwiml } from "../../core/twiml";
import type { TalkerConfig } from "../../types";

export async function handleNoSpeech(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const maxRetries = config.maxNoSpeechRetries ?? 3;

  const retryCount = incrementNoSpeechRetries(phoneNumber);
  const language = getDetectedLanguage(phoneNumber) || "en";

  if (retryCount > maxRetries) {
    logger.info("max retries reached, ending call", { phoneNumber, retryCount });
    const finalMessage = getPhrase(language, "didNotHearFinal", config.languageDir);
    return c.text(sayTwiml(finalMessage, language, config), 200, { "Content-Type": "text/xml" });
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

  return c.text(gatherTwiml(prompt, language, config, phoneNumber), 200, {
    "Content-Type": "text/xml",
  });
}

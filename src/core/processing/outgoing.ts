/**
 * Outgoing Response Processor
 *
 * Post-processes outgoing responses: channel-appropriate formatting
 * (voice vs SMS), language translation, brevity enforcement.
 */

import type { Channel, TalkerDependencies } from "../../types";
import { addMessage, getDetectedLanguage } from "../context";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";
import { callOpenAI } from "./openai";
import { getOutgoingPrompt } from "./prompts";

/**
 * Post-process an outgoing response for the telephony channel
 */
export async function processOutgoing(
  deps: TalkerDependencies,
  phoneNumber: string,
  botResponse: string,
  channel: Channel = "call",
): Promise<string> {
  try {
    const language = getDetectedLanguage(phoneNumber) || "en";
    const prompt = getOutgoingPrompt(deps);
    const promptWithContext = `${prompt}\n\n---\nChannel: ${channel}\nRespond in: ${language}`;

    const result = await callOpenAI(deps, promptWithContext, botResponse, {
      phoneNumber,
      stage: "outgoing",
    });

    addMessage(phoneNumber, "assistant", result || botResponse, channel);

    logger.info("OUTGOING", {
      phoneNumber,
      channel,
      in: botResponse,
      out: result,
      lang: language,
    });

    return result || botResponse;
  } catch (error) {
    logger.error("outgoing processing error", {
      phoneNumber,
      channel,
      error: getErrorMessage(error),
    });
    return botResponse;
  }
}

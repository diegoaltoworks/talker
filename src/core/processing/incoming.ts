/**
 * Incoming Message Processor
 *
 * Pre-processes incoming messages: language detection, transfer intent,
 * end-call detection, and STT artifact cleanup.
 */

import type { Channel, IncomingResult, TalkerDependencies } from "../../types";
import {
  addMessage,
  getDetectedLanguage,
  getMessageHistory,
  getOrCreateContext,
  setDetectedLanguage,
} from "../context";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";
import { callOpenAI } from "./openai";
import { getIncomingPrompt } from "./prompts";

/**
 * Pre-process an incoming message
 */
export async function processIncoming(
  deps: TalkerDependencies,
  phoneNumber: string,
  userMessage: string,
  channel: Channel = "call",
): Promise<IncomingResult> {
  try {
    getOrCreateContext(phoneNumber, channel);

    // Get conversation history BEFORE adding current message
    const history = getMessageHistory(phoneNumber);
    addMessage(phoneNumber, "user", userMessage, channel);

    // Build context-aware message
    let contextualMessage = userMessage;
    if (history.length > 0) {
      const recentHistory = history.slice(-4);
      const historyText = recentHistory
        .map((m) => `${m.role === "user" ? "Customer" : "Bot"}: ${m.content}`)
        .join("\n");
      contextualMessage = `CONVERSATION HISTORY:\n${historyText}\n\nCURRENT MESSAGE:\n${userMessage}`;
    }

    const result = await callOpenAI(deps, getIncomingPrompt(deps), contextualMessage, {
      phoneNumber,
      stage: "incoming",
    });

    // Strip markdown code blocks if present
    const cleanedResult = result
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedResult) as {
      shouldTransfer?: boolean;
      shouldEndCall?: boolean;
      detectedLanguage?: string;
      processedMessage?: string;
    };

    const detectedLang = parsed.detectedLanguage || "en";
    setDetectedLanguage(phoneNumber, detectedLang);
    const storedLanguage = getDetectedLanguage(phoneNumber) || "en";

    logger.info("INCOMING", {
      phoneNumber,
      channel,
      in: userMessage,
      out: parsed.processedMessage,
      lang: storedLanguage,
      ...(parsed.shouldTransfer && { transfer: true }),
      ...(parsed.shouldEndCall && { endCall: true }),
    });

    return {
      shouldTransfer: parsed.shouldTransfer ?? false,
      shouldEndCall: parsed.shouldEndCall ?? false,
      detectedLanguage: storedLanguage,
      processedMessage: parsed.processedMessage || userMessage,
    };
  } catch (error) {
    logger.error("incoming processing error", {
      phoneNumber,
      error: getErrorMessage(error),
    });
    return {
      shouldTransfer: false,
      shouldEndCall: false,
      detectedLanguage: getDetectedLanguage(phoneNumber) || "en",
      processedMessage: userMessage,
    };
  }
}

/**
 * HTTP Chatbot Client
 *
 * Calls a remote chatbot API (e.g., chatter's /api/public/chat) over HTTP.
 * Maintains multi-turn conversation history per phone number.
 */

import type { ChatbotConfig } from "../../types";
import { resolveLanguage } from "../context";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";
import { getPhrase } from "../phrases";
import { addBotMessage, addUserMessage, getOrCreateConversation } from "./conversations";
import type { ChatbotResponse } from "./types";

const DEFAULT_SYSTEM_MESSAGE =
  "You are a voice assistant. Always refer to the subject in third person.";

/**
 * Send a message to the remote chatbot API and get a response.
 *
 * Both no-answer outcomes - a transport or HTTP failure, and a 200 whose
 * `reply` is empty - resolve the same `chatError` phrase in the caller's
 * detected language, the one `chat()` uses for its other two paths. They are
 * one situation from the caller's side (no usable answer), and the reply is
 * spoken or sent verbatim, so an English literal here would reach a caller
 * mid-conversation in their own language.
 *
 * `languageDir` is threaded in rather than read from a config this module
 * doesn't receive: `ChatbotConfig` is the remote endpoint's settings, not the
 * package's. Omitting it falls back to the built-in phrase files.
 */
export async function chatViaHTTP(
  config: ChatbotConfig,
  phoneNumber: string,
  message: string,
  languageDir?: string,
): Promise<string> {
  const systemMessage = config.systemMessage || DEFAULT_SYSTEM_MESSAGE;
  const errorReply = () => getPhrase(resolveLanguage(phoneNumber), "chatError", languageDir);

  // Track conversation history
  addUserMessage(phoneNumber, message, systemMessage);
  const conversation = getOrCreateConversation(phoneNumber, systemMessage);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }

  const body = JSON.stringify({
    messages: conversation.chatHistory,
  });

  logger.info("chatbot request", {
    phoneNumber,
    conversationId: conversation.conversationId,
    message,
    historyLength: conversation.chatHistory.length,
  });

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("chatbot error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(`Chatbot API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as ChatbotResponse;

    logger.info("chatbot response", {
      phoneNumber,
      conversationId: conversation.conversationId,
      reply: data.reply,
    });

    const answer = data.reply || errorReply();
    addBotMessage(phoneNumber, answer, systemMessage);

    return answer;
  } catch (error) {
    logger.error("chatbot request failed", {
      phoneNumber,
      error: getErrorMessage(error),
    });
    return errorReply();
  }
}

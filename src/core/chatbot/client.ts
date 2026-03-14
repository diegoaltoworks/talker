/**
 * HTTP Chatbot Client
 *
 * Calls a remote chatbot API (e.g., chatter's /api/public/chat) over HTTP.
 * Maintains multi-turn conversation history per phone number.
 */

import type { ChatbotConfig } from "../../types";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";
import { addBotMessage, addUserMessage, getOrCreateConversation } from "./conversations";
import type { ChatbotResponse } from "./types";

const DEFAULT_SYSTEM_MESSAGE =
  "You are a voice assistant. Always refer to the subject in third person.";

/**
 * Send a message to the remote chatbot API and get a response
 */
export async function chatViaHTTP(
  config: ChatbotConfig,
  phoneNumber: string,
  message: string,
): Promise<string> {
  const systemMessage = config.systemMessage || DEFAULT_SYSTEM_MESSAGE;

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
    message: message.substring(0, 100),
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
      reply: data.reply.substring(0, 200),
    });

    const answer = data.reply || "Sorry, I could not process your request.";
    addBotMessage(phoneNumber, answer, systemMessage);

    return answer;
  } catch (error) {
    logger.error("chatbot request failed", {
      phoneNumber,
      error: getErrorMessage(error),
    });
    return "Sorry, I encountered an error processing your question.";
  }
}

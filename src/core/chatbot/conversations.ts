/**
 * Chatbot Conversation Store
 *
 * Tracks multi-turn conversation history per phone number for the HTTP chatbot client.
 * Only used in standalone mode (plugin mode uses chatter's own conversation handling).
 *
 * Module-level singleton, single-process only - see docs/ARCHITECTURE.md's
 * "Single-process state caveat". Unlike the other maps that section lists,
 * this one has no TTL sweep, so an entry lives until `clearConversation` is
 * called or the process restarts; nothing in src/routes/ calls it today.
 * `conversationId` is minted locally (`crypto.randomUUID()`) purely for
 * log/DB correlation - it is never sent to the remote chatbot API and does
 * not change across calls from the same number, so read
 * `talker_sessions.conversation_id` as "which in-process chatbot
 * conversation produced this row," not as a per-call identifier.
 */

import { logger } from "../logger";
import type { ChatConversation } from "./types";

const conversations = new Map<string, ChatConversation>();

export function getOrCreateConversation(
  phoneNumber: string,
  systemMessage?: string,
): ChatConversation {
  const existing = conversations.get(phoneNumber);
  if (existing) {
    existing.lastActivityAt = Date.now();
    return existing;
  }

  const conversation: ChatConversation = {
    conversationId: crypto.randomUUID(),
    chatHistory: systemMessage ? [{ role: "system", content: systemMessage }] : [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  conversations.set(phoneNumber, conversation);
  logger.info("chatbot conversation created", {
    phoneNumber,
    conversationId: conversation.conversationId,
  });
  return conversation;
}

export function addUserMessage(phoneNumber: string, content: string, systemMessage?: string): void {
  const conversation = getOrCreateConversation(phoneNumber, systemMessage);
  conversation.chatHistory.push({ role: "user", content });
  conversation.lastActivityAt = Date.now();
}

export function addBotMessage(phoneNumber: string, content: string, systemMessage?: string): void {
  const conversation = getOrCreateConversation(phoneNumber, systemMessage);
  conversation.chatHistory.push({ role: "assistant", content });
  conversation.lastActivityAt = Date.now();
}

export function getConversation(phoneNumber: string): ChatConversation | undefined {
  return conversations.get(phoneNumber);
}

export function clearConversation(phoneNumber: string): void {
  conversations.delete(phoneNumber);
}

export function clearAllConversations(): void {
  conversations.clear();
}

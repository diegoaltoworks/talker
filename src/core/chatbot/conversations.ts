/**
 * Chatbot Conversation Store
 *
 * Tracks multi-turn conversation history per phone number for the HTTP chatbot client.
 * Only used in standalone mode (plugin mode uses chatter's own conversation handling).
 *
 * Module-level singleton, single-process only - see docs/ARCHITECTURE.md's
 * "Single-process state caveat". `sweepConversations` gives it the same TTL
 * sweep as `src/core/context.ts` and `src/routes/call/pending.ts`; plugin and
 * standalone mode call it from the shared cleanup tick (see `src/core/mount.ts`)
 * with `contextTtlMs`, so an idle conversation doesn't outlive its context.
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

/**
 * Delete conversations idle for longer than `ttlMs`. Without this a caller
 * who never triggers `clearConversation` - nothing in src/routes/ calls it -
 * would leak an entry for the process lifetime.
 */
export function sweepConversations(ttlMs: number): void {
  const now = Date.now();
  for (const [phoneNumber, conversation] of conversations) {
    if (now - conversation.lastActivityAt > ttlMs) {
      conversations.delete(phoneNumber);
    }
  }
}

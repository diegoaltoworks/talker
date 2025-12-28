/**
 * Chatbot Client Types
 *
 * Matches chatter's /api/public/chat request/response format.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatbotRequest {
  /** Single message (simple mode) */
  message?: string;
  /** Full conversation history (multi-turn mode) */
  messages?: ChatMessage[];
}

export interface ChatbotResponse {
  reply: string;
}

export interface ChatConversation {
  conversationId: string;
  chatHistory: ChatMessage[];
  createdAt: number;
  lastActivityAt: number;
}

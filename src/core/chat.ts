/**
 * Chat Function
 *
 * Resolves a chat response using the first available method:
 * 1. chatFn (custom function override)
 * 2. chatbot config (remote HTTP API — standalone mode)
 * 3. chatter RAG pipeline (plugin mode)
 */

import type { TalkerDependencies } from "../types";
import { chatViaHTTP } from "./chatbot/client";
import { getErrorMessage } from "./errors";
import { logger } from "./logger";

/**
 * Get a chat response
 */
export async function chat(
  deps: TalkerDependencies,
  phoneNumber: string,
  message: string,
): Promise<string> {
  // 1. Custom chat function (highest priority)
  if (deps.config.chatFn) {
    return deps.config.chatFn(phoneNumber, message);
  }

  // 2. Remote chatbot API via HTTP (standalone mode)
  if (deps.config.chatbot?.url) {
    return chatViaHTTP(deps.config.chatbot, phoneNumber, message);
  }

  // 3. Chatter RAG pipeline (plugin mode)
  try {
    const { completeOnce } = await import("@diegoaltoworks/chatter");
    const { client, store, prompts } = deps.chatter;

    const ragContext = await store.query(message, 6, ["base", "public"]);

    // Optional persona swap: replaces the public persona layer only - base
    // rules and retrieved context are always kept.
    let personaLayer: string | null | undefined;
    if (deps.config.personaFn) {
      try {
        personaLayer = await deps.config.personaFn(phoneNumber, message);
      } catch (error) {
        logger.error("personaFn error, using default persona", {
          phoneNumber,
          error: getErrorMessage(error),
        });
      }
    }

    const system = [
      prompts.baseSystemRules,
      personaLayer || prompts.publicPersona,
      `Context:\n${ragContext.join("\n\n")}`,
    ].join("\n\n");

    const result = await completeOnce({
      client,
      system,
      messages: [{ role: "user", content: message }],
    });

    return result.content;
  } catch (error) {
    logger.error("chat error", { phoneNumber, error: getErrorMessage(error) });
    return "Sorry, I encountered an error processing your question.";
  }
}

/**
 * Chat Function
 *
 * Resolves a chat response using the first available method:
 * 1. chatFn (custom function override)
 * 2. chatbot config (remote HTTP API — standalone mode)
 * 3. chatter RAG pipeline (plugin mode), via chatter's prepareChat
 */

import type { Channel, TalkerDependencies } from "../types";
import { chatViaHTTP } from "./chatbot/client";
import { getErrorMessage } from "./errors";
import { logger } from "./logger";

/**
 * Per-channel instruction appended to the assembled system prompt. Kept to
 * naming the channel only - detailed formatting rules (length, markdown,
 * URLs) live in prompts/outgoing.md, which processOutgoing runs after this,
 * so they aren't duplicated (and possibly contradicted) here.
 */
const CHANNEL_HINTS: Record<Channel, string> = {
  call: "This reply will be spoken aloud on a live phone call.",
  sms: "This reply will be sent as an SMS text message.",
  whatsapp: "This reply will be sent as a WhatsApp message.",
};

/**
 * Get a chat response
 */
export async function chat(
  deps: TalkerDependencies,
  phoneNumber: string,
  message: string,
  channel: Channel,
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
    const { completeOnce, prepareChat, resolveBuckets } = await import("@diegoaltoworks/chatter");
    const { client, store, prompts, config: chatterConfig } = deps.chatter;

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

    // Per-sender retrieval scope, gated by the host's bucketsFor hook (if
    // configured). Undefined leaves the pipeline's mode defaults in place.
    // "unknown" is the sentinel talker's channels use when Twilio omits a
    // sender (see redactPhone in ./logger) - treat it as anonymous so the
    // hook's per-sender ceiling still applies.
    const sender = phoneNumber && phoneNumber !== "unknown" ? phoneNumber : undefined;
    const buckets = await resolveBuckets({
      mode: "public",
      sender,
      bucketsFor: chatterConfig.bucketsFor,
    });

    const { system, messages } = await prepareChat({
      store,
      prompts,
      mode: "public",
      messages: [{ role: "user", content: message }],
      personaLayer: personaLayer || undefined,
      channelHint: CHANNEL_HINTS[channel],
      buckets,
    });

    const result = await completeOnce({ client, system, messages });

    return result.content;
  } catch (error) {
    logger.error("chat error", { phoneNumber, error: getErrorMessage(error) });
    return "Sorry, I encountered an error processing your question.";
  }
}

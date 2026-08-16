/**
 * Chat Function
 *
 * Resolves a chat response using the first available method:
 * 1. chatFn (custom function override)
 * 2. chatbot config (remote HTTP API — standalone mode)
 * 3. chatter RAG pipeline (plugin mode), via chatter's prepareChat + answerOnce
 *
 * All three paths are guarded: a throw anywhere along the chain is logged and
 * answered with a generic apology reply rather than propagating, so a
 * failure in one hook can't take down the whole request differently
 * depending on which branch was active. All three resolve that apology from
 * the same `chatError` phrase key, in the caller's detected language - it is
 * spoken on a call and sent as a message, so it is caller-facing copy like
 * any other and does not belong in the code.
 */

import type { Channel, TalkerDependencies } from "../types";
import { chatViaHTTP } from "./chatbot/client";
import { resolveLanguage } from "./context";
import { getErrorMessage } from "./errors";
import { logger } from "./logger";
import { getPhrase } from "./phrases";

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
  const genericErrorReply = () =>
    getPhrase(resolveLanguage(phoneNumber), "chatError", deps.config.languageDir);

  // 1. Custom chat function (highest priority). Guarded like every other
  // hook: an override that throws must not behave differently from one that
  // fails inside the built-in pipeline below.
  if (deps.config.chatFn) {
    try {
      return await deps.config.chatFn(phoneNumber, message);
    } catch (error) {
      logger.error("chatFn error", { phoneNumber, error: getErrorMessage(error) });
      return genericErrorReply();
    }
  }

  // 2. Remote chatbot API via HTTP (standalone mode)
  if (deps.config.chatbot?.url) {
    return chatViaHTTP(deps.config.chatbot, phoneNumber, message, deps.config.languageDir);
  }

  // 3. Chatter RAG pipeline (plugin mode)
  try {
    const { answerOnce, prepareChat, resolveBuckets } = await import("@diegoaltoworks/chatter");
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
    // hook's per-sender ceiling still applies. The same sender identity is
    // handed to answerFn below, so a host's brain sees who is asking.
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

    // Routed through answerOnce (not completeOnce directly) so a host's
    // chatter-level answerFn - an agent framework, a graph runtime - answers
    // telephony turns exactly like every other chatter surface. With no
    // answerFn configured this is the same built-in completion as before.
    const result = await answerOnce({
      answerFn: chatterConfig.answerFn,
      client,
      system,
      messages,
      mode: "public",
      sender,
    });

    return result.content;
  } catch (error) {
    logger.error("chat error", { phoneNumber, error: getErrorMessage(error) });
    return genericErrorReply();
  }
}

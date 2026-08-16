/**
 * Initial Call Handler
 *
 * Handles POST /call — the first webhook when a call arrives.
 * Clears previous state, greets the caller, and starts listening for speech.
 */

import type { Context } from "hono";
import { clearContext } from "../../core/context";
import { UNKNOWN_PHONE_NUMBER } from "../../core/defaults";
import { resolveGreeting } from "../../core/greeting";
import { DEFAULT_LANGUAGE } from "../../core/language";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getPhrase } from "../../core/phrases";
import { gatherTwiml, twimlResponse } from "../../core/twiml";
import type { TalkerConfig } from "../../types";

export async function handleInitialCall(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || UNKNOWN_PHONE_NUMBER).trim();
  const to = (body.To as string) || "";
  logger.info("call started", { phoneNumber });

  clearContext(phoneNumber);

  // The only phrase lookup in the package that does not resolve a detected
  // language: this handler just cleared the context, and the caller has not
  // said a word yet, so there is nothing to detect from. Every later turn
  // goes through `resolveLanguage`.
  const greeting =
    (await resolveGreeting(config, phoneNumber, "call")) ??
    getPhrase(DEFAULT_LANGUAGE, "greeting", config.languageDir);

  emitMessageTap(config, {
    direction: "outbound",
    channel: "call",
    from: to,
    to: phoneNumber,
    body: greeting,
  });

  // gatherTwiml nests the greeting inside Gather (barge-in) and redirects to
  // /call/no-speech on silence, so the retry ladder engages from turn one.
  const twiml = gatherTwiml(greeting, DEFAULT_LANGUAGE, config, phoneNumber);
  return twimlResponse(c, twiml);
}

/**
 * Initial Call Handler
 *
 * Handles POST /call — the first webhook when a call arrives.
 * Clears previous state, greets the caller, and starts listening for speech.
 */

import type { Context } from "hono";
import { clearContext } from "../../core/context";
import { logger } from "../../core/logger";
import { getPhrase } from "../../core/phrases";
import { getVoiceConfig } from "../../core/voice";
import type { TalkerConfig } from "../../types";

export async function handleInitialCall(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  logger.info("call started", { phoneNumber });

  clearContext(phoneNumber);

  const { voice, language: lang } = getVoiceConfig("en", config.voices);
  const greeting = getPhrase("en", "greeting", config.languageDir);
  const didNotHear = getPhrase("en", "didNotHear", config.languageDir);
  const prefix = config.routePrefix || "";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${greeting}</Say>
    <Gather input="speech" action="${prefix}/call/respond" method="POST" speechTimeout="auto" language="${lang}">
    </Gather>
    <Say voice="${voice}" language="${lang}">${didNotHear}</Say>
</Response>`;

  return c.text(twiml, 200, { "Content-Type": "text/xml" });
}

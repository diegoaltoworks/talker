/**
 * Initial Call Handler
 *
 * Handles POST /call — the first webhook when a call arrives.
 * Clears previous state, greets the caller, and starts listening for speech.
 */

import type { Context } from "hono";
import { clearContext } from "../../core/context";
import { resolveGreeting } from "../../core/greeting";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getPhrase } from "../../core/phrases";
import { getVoiceConfig } from "../../core/voice";
import { escapeXml } from "../../core/xml";
import type { TalkerConfig } from "../../types";

export async function handleInitialCall(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const to = (body.To as string) || "";
  logger.info("call started", { phoneNumber });

  clearContext(phoneNumber);

  const { voice, language: lang } = getVoiceConfig("en", config.voices);
  const greeting =
    (await resolveGreeting(config, phoneNumber, "call")) ??
    getPhrase("en", "greeting", config.languageDir);
  const didNotHear = getPhrase("en", "didNotHear", config.languageDir);
  const prefix = config.routePrefix || "";

  emitMessageTap(config, {
    direction: "outbound",
    channel: "call",
    from: to,
    to: phoneNumber,
    body: greeting,
  });

  // Escaped at interpolation: a host greetingFn can return anything, and a
  // bare "&" makes Twilio reject the document (12100) and drop the call.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(greeting)}</Say>
    <Gather input="speech" action="${escapeXml(prefix)}/call/respond" method="POST" speechTimeout="auto" language="${escapeXml(lang)}">
    </Gather>
    <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(didNotHear)}</Say>
</Response>`;

  return c.text(twiml, 200, { "Content-Type": "text/xml" });
}

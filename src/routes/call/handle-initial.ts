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
import { gatherTwiml } from "../../core/twiml";
import type { TalkerConfig } from "../../types";

export async function handleInitialCall(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const to = (body.To as string) || "";
  logger.info("call started", { phoneNumber });

  clearContext(phoneNumber);

  const greeting =
    (await resolveGreeting(config, phoneNumber, "call")) ??
    getPhrase("en", "greeting", config.languageDir);

  emitMessageTap(config, {
    direction: "outbound",
    channel: "call",
    from: to,
    to: phoneNumber,
    body: greeting,
  });

  // gatherTwiml nests the greeting inside Gather (barge-in) and redirects to
  // /call/no-speech on silence, so the retry ladder engages from turn one.
  const twiml = gatherTwiml(greeting, "en", config, phoneNumber);
  return c.text(twiml, 200, { "Content-Type": "text/xml" });
}

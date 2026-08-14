/**
 * Incoming WhatsApp Handler
 *
 * Handles POST /whatsapp — called by Twilio when a WhatsApp message arrives.
 * Twilio sends the same webhook format as SMS, but with `whatsapp:` prefixed
 * phone numbers in the From/To fields.
 */

import type { Context } from "hono";
import { stripWhatsAppPrefix } from "../../adapters/twilio";
import { getErrorMessage } from "../../core/errors";
import { resolveGreeting } from "../../core/greeting";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getWhatsAppPhrase } from "../../core/phrases";
import { messageTwiml } from "../../core/twiml";
import { persistSession } from "../../db/persist";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { processWhatsApp } from "./processor";

export async function handleIncomingWhatsApp(
  c: Context,
  deps: TalkerDependencies,
  registry: FlowRegistry,
): Promise<Response> {
  const body = await c.req.parseBody();
  const rawFrom = ((body.From as string) || "unknown").trim();
  const phoneNumber = stripWhatsAppPrefix(rawFrom);
  const to = stripWhatsAppPrefix((body.To as string) || "");
  const messageBody = (body.Body as string) || "";

  logger.info("whatsapp message received", { phoneNumber, messageBody });
  emitMessageTap(deps.config, {
    direction: "inbound",
    channel: "whatsapp",
    from: phoneNumber,
    to,
    body: messageBody,
  });

  if (!messageBody.trim()) {
    const greeting =
      (await resolveGreeting(deps.config, phoneNumber, "whatsapp")) ??
      getWhatsAppPhrase("en", "greeting", deps.config.languageDir);
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel: "whatsapp",
      from: to,
      to: phoneNumber,
      body: greeting,
    });
    return c.text(messageTwiml(greeting), 200, {
      "Content-Type": "text/xml",
    });
  }

  try {
    const twiml = await processWhatsApp(deps, registry, phoneNumber, messageBody, to);
    persistSession(phoneNumber, "whatsapp");
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("whatsapp processing error", {
      phoneNumber,
      error: getErrorMessage(error),
    });
    const errorMessage = getWhatsAppPhrase("en", "genericError", deps.config.languageDir);
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel: "whatsapp",
      from: to,
      to: phoneNumber,
      body: errorMessage,
    });
    return c.text(messageTwiml(errorMessage), 200, { "Content-Type": "text/xml" });
  }
}

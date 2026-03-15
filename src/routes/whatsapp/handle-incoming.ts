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
import { logger } from "../../core/logger";
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
  const messageBody = (body.Body as string) || "";

  logger.info("whatsapp message received", { phoneNumber, messageBody });

  if (!messageBody.trim()) {
    return c.text(messageTwiml(getWhatsAppPhrase("en", "greeting", deps.config.languageDir)), 200, {
      "Content-Type": "text/xml",
    });
  }

  try {
    const twiml = await processWhatsApp(deps, registry, phoneNumber, messageBody);
    persistSession(phoneNumber, "whatsapp");
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("whatsapp processing error", {
      phoneNumber,
      error: getErrorMessage(error),
    });
    return c.text(
      messageTwiml(getWhatsAppPhrase("en", "genericError", deps.config.languageDir)),
      200,
      { "Content-Type": "text/xml" },
    );
  }
}

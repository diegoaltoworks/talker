/**
 * Incoming Messaging Handler
 *
 * Handles POST /sms and POST /whatsapp — called by Twilio when a message
 * arrives. WhatsApp sends the same webhook format as SMS, but with
 * `whatsapp:` prefixed phone numbers in the From/To fields.
 */

import type { Context } from "hono";
import { stripWhatsAppPrefix } from "../../adapters/twilio";
import { getErrorMessage } from "../../core/errors";
import { resolveGreeting } from "../../core/greeting";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getChannelPhrase } from "../../core/phrases";
import { messageTwiml } from "../../core/twiml";
import { persistSession } from "../../db/persist";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { type MessagingChannel, processMessage } from "./processor";

export async function handleIncomingMessage(
  c: Context,
  deps: TalkerDependencies,
  registry: FlowRegistry,
  channel: MessagingChannel,
): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = stripWhatsAppPrefix(((body.From as string) || "unknown").trim());
  const to = stripWhatsAppPrefix((body.To as string) || "");
  const messageBody = (body.Body as string) || "";

  logger.info(`${channel} message received`, { phoneNumber, messageBody });
  emitMessageTap(deps.config, {
    direction: "inbound",
    channel,
    from: phoneNumber,
    to,
    body: messageBody,
  });

  if (!messageBody.trim()) {
    const greeting =
      (await resolveGreeting(deps.config, phoneNumber, channel)) ??
      getChannelPhrase(channel, "en", "greeting", deps.config.languageDir);
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel,
      from: to,
      to: phoneNumber,
      body: greeting,
    });
    return c.text(messageTwiml(greeting), 200, {
      "Content-Type": "text/xml",
    });
  }

  try {
    const twiml = await processMessage(deps, registry, phoneNumber, messageBody, to, channel);
    persistSession(phoneNumber, channel);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error(`${channel} processing error`, {
      phoneNumber,
      error: getErrorMessage(error),
    });
    const errorMessage = getChannelPhrase(channel, "en", "genericError", deps.config.languageDir);
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel,
      from: to,
      to: phoneNumber,
      body: errorMessage,
    });
    return c.text(messageTwiml(errorMessage), 200, {
      "Content-Type": "text/xml",
    });
  }
}

/**
 * Shared Fallback Handler
 *
 * Handles POST /sms/fallback and /whatsapp/fallback — called by Twilio
 * when the primary incoming message webhook URL cannot be reached or
 * throws a runtime exception.
 *
 * Twilio sends the same payload as the incoming message webhook.
 * The fallback handler responds with a safe error message so the
 * end user is not left without a response.
 */

import type { Context } from "hono";
import { stripWhatsAppPrefix } from "../../adapters/twilio";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getChannelPhrase } from "../../core/phrases";
import { messageTwiml } from "../../core/twiml";
import { getSanitizedBody } from "../../middleware/input-sanitize";
import type { TalkerDependencies } from "../../types";

/**
 * Handle a fallback webhook from Twilio.
 * Called when the primary incoming URL fails.
 * Returns a safe error message TwiML to the user.
 */
export async function handleFallback(
  c: Context,
  deps: TalkerDependencies,
  channel: "sms" | "whatsapp",
): Promise<Response> {
  const body = await getSanitizedBody(c);

  const rawFrom = (body.From as string) || "unknown";
  const rawTo = (body.To as string) || "";
  const phoneNumber = channel === "whatsapp" ? stripWhatsAppPrefix(rawFrom) : rawFrom.trim();
  const to = channel === "whatsapp" ? stripWhatsAppPrefix(rawTo) : rawTo;
  const messageBody = (body.Body as string) || "";
  const errorCode = body.ErrorCode as string | undefined;
  const errorUrl = body.ErrorUrl as string | undefined;

  logger.error("fallback webhook triggered", {
    channel,
    phoneNumber,
    messageBody,
    errorCode,
    errorUrl,
  });
  emitMessageTap(deps.config, {
    direction: "inbound",
    channel,
    from: phoneNumber,
    to,
    body: messageBody,
  });

  // Respond with a generic error message appropriate to the channel
  const errorMessage = getChannelPhrase(channel, "en", "genericError", deps.config.languageDir);

  emitMessageTap(deps.config, {
    direction: "outbound",
    channel,
    from: to,
    to: phoneNumber,
    body: errorMessage,
  });
  return c.text(messageTwiml(errorMessage), 200, { "Content-Type": "text/xml" });
}

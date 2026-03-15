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
import { getSmsPhrase, getWhatsAppPhrase } from "../../core/phrases";
import { messageTwiml } from "../../core/twiml";
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
  const body = await c.req.parseBody();

  const rawFrom = (body.From as string) || "unknown";
  const phoneNumber = channel === "whatsapp" ? stripWhatsAppPrefix(rawFrom) : rawFrom.trim();
  const messageBody = (body.Body as string) || "";
  const errorCode = body.ErrorCode as string | undefined;
  const errorUrl = body.ErrorUrl as string | undefined;

  logger.error("fallback webhook triggered", {
    channel,
    phoneNumber,
    messageBody: messageBody.substring(0, 100),
    errorCode,
    errorUrl,
  });

  // Respond with a generic error message appropriate to the channel
  const errorMessage =
    channel === "whatsapp"
      ? getWhatsAppPhrase("en", "genericError", deps.config.languageDir)
      : getSmsPhrase("en", "genericError", deps.config.languageDir);

  return c.text(messageTwiml(errorMessage), 200, { "Content-Type": "text/xml" });
}

/**
 * Shared Message Status Callback Handler
 *
 * Handles POST /sms/status and /whatsapp/status — called by Twilio
 * when a message delivery status changes (queued, sent, delivered,
 * undelivered, failed, read).
 *
 * Twilio sends these fields (among others):
 * - MessageSid: unique message identifier
 * - MessageStatus: queued | sending | sent | delivered | undelivered | failed | read
 * - From: sender phone number
 * - To: recipient phone number
 * - ErrorCode: Twilio error code (only on failure)
 * - ErrorMessage: human-readable error (only on failure)
 */

import type { Context } from "hono";
import { stripWhatsAppPrefix } from "../../adapters/twilio";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../core/logger";
import { upsertMessageStatus } from "../../db/sessions";
import type { Channel, MessageStatusEvent, TalkerDependencies } from "../../types";

/**
 * Handle a message status callback from Twilio.
 * Shared by both SMS and WhatsApp status endpoints.
 */
export async function handleStatusCallback(
  c: Context,
  deps: TalkerDependencies,
  channel: "sms" | "whatsapp",
): Promise<Response> {
  const body = await c.req.parseBody();

  const messageSid = (body.MessageSid as string) || "";
  const messageStatus = (body.MessageStatus as string) || "";
  const rawFrom = (body.From as string) || "";
  const rawTo = (body.To as string) || "";
  const errorCode = body.ErrorCode as string | undefined;
  const errorMessage = body.ErrorMessage as string | undefined;

  // Strip whatsapp: prefix for clean phone numbers
  const from = channel === "whatsapp" ? stripWhatsAppPrefix(rawFrom) : rawFrom;
  const to = channel === "whatsapp" ? stripWhatsAppPrefix(rawTo) : rawTo;

  logger.info("message status callback", {
    channel,
    messageSid,
    messageStatus,
    from,
    to,
    errorCode,
  });

  if (!messageSid || !messageStatus) {
    logger.warn("status callback missing required fields", { channel, messageSid, messageStatus });
    return c.text("", 200);
  }

  // Persist status to database
  upsertMessageStatus({
    messageSid,
    channel,
    from,
    to,
    status: messageStatus,
    errorCode,
    errorMessage,
  }).catch((err) => {
    logger.error("failed to persist message status", {
      messageSid,
      error: getErrorMessage(err),
    });
  });

  // Invoke user callback if configured
  if (deps.config.onMessageStatus) {
    const event: MessageStatusEvent = {
      messageSid,
      messageStatus,
      channel,
      from,
      to,
      errorCode,
      errorMessage,
    };

    try {
      await Promise.resolve(deps.config.onMessageStatus(event));
    } catch (err) {
      logger.error("onMessageStatus callback error", {
        messageSid,
        error: getErrorMessage(err),
      });
    }
  }

  // Twilio expects a 200 response (empty body is fine)
  return c.text("", 200);
}

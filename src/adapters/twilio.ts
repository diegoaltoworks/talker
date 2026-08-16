/**
 * Twilio Adapter
 *
 * Handles outbound SMS and WhatsApp sending via Twilio's REST API.
 * TwiML generation is handled by src/core/twiml.ts.
 */

import { logger } from "../core/logger";
import type { TwilioConfig } from "../types";

/**
 * Strip the `whatsapp:` prefix from a phone number if present.
 * Returns the bare phone number (e.g., "+1234567890").
 */
export function stripWhatsAppPrefix(phoneNumber: string): string {
  return phoneNumber.replace(/^whatsapp:/, "");
}

/**
 * Options for outbound message sending
 */
export interface SendMessageOptions {
  /** Status callback URL for delivery status updates */
  statusCallback?: string;
}

/**
 * Prefix a phone number with `whatsapp:` unless it already has one.
 */
function withWhatsAppPrefix(phoneNumber: string): string {
  return phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;
}

/**
 * Build the form parameters for a Twilio Messages API call.
 * Uses MessagingServiceSid when configured, otherwise From. `applyWhatsAppPrefix`
 * prefixes `From` the same way the caller already prefixed `to` - shared by
 * sendSMS and sendWhatsApp so the two send paths can't diverge.
 */
function buildMessageParams(
  config: TwilioConfig,
  to: string,
  message: string,
  options?: SendMessageOptions,
  applyWhatsAppPrefix = false,
): URLSearchParams {
  const params: Record<string, string> = {
    To: to,
    Body: message,
  };

  // Use MessagingServiceSid if configured, otherwise use From number
  if (config.messagingServiceSid) {
    params.MessagingServiceSid = config.messagingServiceSid;
  } else if (config.phoneNumber) {
    params.From = applyWhatsAppPrefix ? withWhatsAppPrefix(config.phoneNumber) : config.phoneNumber;
  }

  if (options?.statusCallback) {
    params.StatusCallback = options.statusCallback;
  }

  return new URLSearchParams(params);
}

/**
 * Send an SMS via Twilio REST API
 */
export async function sendSMS(
  config: TwilioConfig,
  to: string,
  message: string,
  options?: SendMessageOptions,
): Promise<boolean> {
  if (!config.accountSid || !config.authToken) {
    logger.warn("Twilio credentials not configured, skipping SMS send", { phoneNumber: to });
    return false;
  }

  if (!config.phoneNumber && !config.messagingServiceSid) {
    logger.warn("No phone number or messaging service configured, skipping SMS send", {
      phoneNumber: to,
    });
    return false;
  }

  try {
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buildMessageParams(config, to, message, options),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error("SMS send failed", { phoneNumber: to, status: response.status, error });
      return false;
    }

    const data = (await response.json()) as { sid: string };
    logger.info("SMS sent successfully", { phoneNumber: to, messageSid: data.sid });
    return true;
  } catch (error) {
    logger.error("SMS send error", {
      phoneNumber: to,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

/**
 * Send a WhatsApp message via Twilio REST API.
 *
 * Twilio's WhatsApp API uses the same Messages endpoint as SMS but
 * requires `whatsapp:` prefixed From/To numbers.
 */
export async function sendWhatsApp(
  config: TwilioConfig,
  to: string,
  message: string,
  options?: SendMessageOptions,
): Promise<boolean> {
  if (!config.accountSid || !config.authToken) {
    logger.warn("Twilio credentials not configured, skipping WhatsApp send", { phoneNumber: to });
    return false;
  }

  if (!config.phoneNumber && !config.messagingServiceSid) {
    logger.warn("No phone number or messaging service configured, skipping WhatsApp send", {
      phoneNumber: to,
    });
    return false;
  }

  try {
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buildMessageParams(config, withWhatsAppPrefix(to), message, options, true),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error("WhatsApp send failed", { phoneNumber: to, status: response.status, error });
      return false;
    }

    const data = (await response.json()) as { sid: string };
    logger.info("WhatsApp message sent successfully", { phoneNumber: to, messageSid: data.sid });
    return true;
  } catch (error) {
    logger.error("WhatsApp send error", {
      phoneNumber: to,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

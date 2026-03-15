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
 * Send an SMS via Twilio REST API
 */
export async function sendSMS(config: TwilioConfig, to: string, message: string): Promise<boolean> {
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    logger.warn("Twilio credentials not configured, skipping SMS send", { to });
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
        body: new URLSearchParams({
          From: config.phoneNumber,
          To: to,
          Body: message,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error("SMS send failed", { to, status: response.status, error });
      return false;
    }

    const data = (await response.json()) as { sid: string };
    logger.info("SMS sent successfully", { to, messageSid: data.sid });
    return true;
  } catch (error) {
    logger.error("SMS send error", {
      to,
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
): Promise<boolean> {
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    logger.warn("Twilio credentials not configured, skipping WhatsApp send", { to });
    return false;
  }

  try {
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
    const whatsappTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const whatsappFrom = config.phoneNumber.startsWith("whatsapp:")
      ? config.phoneNumber
      : `whatsapp:${config.phoneNumber}`;

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: whatsappFrom,
          To: whatsappTo,
          Body: message,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error("WhatsApp send failed", { to, status: response.status, error });
      return false;
    }

    const data = (await response.json()) as { sid: string };
    logger.info("WhatsApp message sent successfully", { to, messageSid: data.sid });
    return true;
  } catch (error) {
    logger.error("WhatsApp send error", {
      to,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

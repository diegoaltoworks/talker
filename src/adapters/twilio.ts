/**
 * Twilio Adapter
 *
 * Handles outbound SMS sending via Twilio's REST API.
 * TwiML generation is handled by src/core/twiml.ts.
 */

import { logger } from "../core/logger";
import type { TwilioConfig } from "../types";

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

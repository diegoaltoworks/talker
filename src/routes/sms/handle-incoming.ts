/**
 * Incoming SMS Handler
 *
 * Handles POST /sms — called by Twilio when an SMS arrives.
 */

import type { Context } from "hono";
import { getErrorMessage } from "../../core/errors";
import { resolveGreeting } from "../../core/greeting";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getSmsPhrase } from "../../core/phrases";
import { messageTwiml } from "../../core/twiml";
import { persistSession } from "../../db/persist";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";
import { processSms } from "./processor";

export async function handleIncomingSMS(
  c: Context,
  deps: TalkerDependencies,
  registry: FlowRegistry,
): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const to = (body.To as string) || "";
  const messageBody = (body.Body as string) || "";

  logger.info("sms received", { phoneNumber, messageBody });
  emitMessageTap(deps.config, {
    direction: "inbound",
    channel: "sms",
    from: phoneNumber,
    to,
    body: messageBody,
  });

  if (!messageBody.trim()) {
    const greeting =
      (await resolveGreeting(deps.config, phoneNumber, "sms")) ??
      getSmsPhrase("en", "greeting", deps.config.languageDir);
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel: "sms",
      from: to,
      to: phoneNumber,
      body: greeting,
    });
    return c.text(messageTwiml(greeting), 200, {
      "Content-Type": "text/xml",
    });
  }

  try {
    const twiml = await processSms(deps, registry, phoneNumber, messageBody, to);
    persistSession(phoneNumber, "sms");
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("sms processing error", {
      phoneNumber,
      error: getErrorMessage(error),
    });
    const errorMessage = getSmsPhrase("en", "genericError", deps.config.languageDir);
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel: "sms",
      from: to,
      to: phoneNumber,
      body: errorMessage,
    });
    return c.text(messageTwiml(errorMessage), 200, {
      "Content-Type": "text/xml",
    });
  }
}

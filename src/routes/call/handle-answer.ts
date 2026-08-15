/**
 * Answer Handler
 *
 * Handles POST /call/answer — called after the acknowledgment redirect.
 * Waits for the background processing to complete and returns the result.
 */

import type { Context } from "hono";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getPhrase } from "../../core/phrases";
import { gatherTwiml, sayTwiml } from "../../core/twiml";
import type { TalkerConfig } from "../../types";
import { deletePending, getPending } from "./pending";

// Twilio gives up on a webhook response after ~15s; staying well under that
// means our own timeout phrase is actually spoken instead of Twilio's error.
const DEFAULT_ANSWER_BUDGET_MS = 8000;

export async function handleAnswer(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const to = (body.To as string) || "";

  const pending = getPending(phoneNumber);
  if (!pending) {
    logger.warn("no pending query found", { phoneNumber });
    const message = getPhrase("en", "lostQuestion", config.languageDir);
    emitMessageTap(config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body: message,
    });
    const twiml = gatherTwiml(message, "en", config, phoneNumber);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }

  const budgetMs = config.callAnswerBudgetMs ?? DEFAULT_ANSWER_BUDGET_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ twiml: string }>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("Processing timeout")), budgetMs);
  });

  try {
    const result = await Promise.race([pending.promise, timeoutPromise]);
    return c.text(result.twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("answer error", { phoneNumber, error: getErrorMessage(error) });
    const message = getPhrase("en", "timeout", config.languageDir);
    emitMessageTap(config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body: message,
    });
    const twiml = sayTwiml(message, "en", config);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  } finally {
    clearTimeout(timeoutHandle);
    deletePending(phoneNumber);
  }
}

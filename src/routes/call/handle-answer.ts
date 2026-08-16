/**
 * Answer Handler
 *
 * Handles POST /call/answer — called after the acknowledgment redirect.
 * Waits for the background processing to complete and returns the result.
 */

import type { Context } from "hono";
import { resolveLanguage } from "../../core/context";
import { UNKNOWN_PHONE_NUMBER } from "../../core/defaults";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getPhrase } from "../../core/phrases";
import { gatherTwiml, sayTwiml, twimlResponse } from "../../core/twiml";
import type { TalkerConfig } from "../../types";
import { deletePending, getPending } from "./pending";

// Twilio gives up on a webhook response after ~15s; staying well under that
// means our own timeout phrase is actually spoken instead of Twilio's error.
export const DEFAULT_ANSWER_BUDGET_MS = 8000;

export async function handleAnswer(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || UNKNOWN_PHONE_NUMBER).trim();
  const to = (body.To as string) || "";

  const pending = getPending(phoneNumber);
  if (!pending) {
    logger.warn("no pending query found", { phoneNumber });
    // The caller has already spoken by the time this webhook fires (it is
    // the redirect target of the acknowledgment), so detection has usually
    // run even though the query itself is gone.
    const language = resolveLanguage(phoneNumber);
    const message = getPhrase(language, "lostQuestion", config.languageDir);
    emitMessageTap(config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body: message,
    });
    const twiml = gatherTwiml(message, language, config, phoneNumber);
    return twimlResponse(c, twiml);
  }

  const budgetMs = config.callAnswerBudgetMs ?? DEFAULT_ANSWER_BUDGET_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ twiml: string }>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("Processing timeout")), budgetMs);
  });

  try {
    const result = await Promise.race([pending.promise, timeoutPromise]);
    return twimlResponse(c, result.twiml);
  } catch (error) {
    logger.error("answer error", { phoneNumber, error: getErrorMessage(error) });
    // Resolved after the race, not before it: background processing runs
    // detection and may have recorded the caller's language while this
    // handler was waiting on the budget.
    const language = resolveLanguage(phoneNumber);
    const message = getPhrase(language, "timeout", config.languageDir);
    emitMessageTap(config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body: message,
    });
    const twiml = sayTwiml(message, language, config);
    return twimlResponse(c, twiml);
  } finally {
    clearTimeout(timeoutHandle);
    deletePending(phoneNumber);
  }
}

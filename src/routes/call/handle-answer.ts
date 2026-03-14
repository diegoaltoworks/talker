/**
 * Answer Handler
 *
 * Handles POST /call/answer — called after the acknowledgment redirect.
 * Waits for the background processing to complete and returns the result.
 */

import type { Context } from "hono";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../core/logger";
import { getPhrase } from "../../core/phrases";
import { gatherTwiml, sayTwiml } from "../../core/twiml";
import type { TalkerConfig } from "../../types";
import { deletePending, getPending } from "./pending";

export async function handleAnswer(c: Context, config: TalkerConfig): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();

  const pending = getPending(phoneNumber);
  if (!pending) {
    logger.warn("no pending query found", { phoneNumber });
    const twiml = gatherTwiml(
      getPhrase("en", "lostQuestion", config.languageDir),
      "en",
      config,
      phoneNumber,
    );
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }

  try {
    const timeoutPromise = new Promise<{ twiml: string }>((_, reject) => {
      setTimeout(() => reject(new Error("Processing timeout")), 30000);
    });

    const result = await Promise.race([pending.promise, timeoutPromise]);
    deletePending(phoneNumber);

    return c.text(result.twiml, 200, { "Content-Type": "text/xml" });
  } catch (error) {
    logger.error("answer error", { phoneNumber, error: getErrorMessage(error) });
    deletePending(phoneNumber);
    const twiml = sayTwiml(getPhrase("en", "timeout", config.languageDir), "en", config);
    return c.text(twiml, 200, { "Content-Type": "text/xml" });
  }
}

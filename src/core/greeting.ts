/**
 * Dynamic greeting resolution (TalkerConfig.greetingFn).
 *
 * Lets the host compute a greeting per caller and channel - by name, persona,
 * mood - without an LLM round-trip. Null/undefined or a thrown error falls
 * back to the phrase-file greeting at the call site.
 */

import type { Channel, TalkerConfig } from "../types";
import { getErrorMessage } from "./errors";
import { logger } from "./logger";

export async function resolveGreeting(
  config: TalkerConfig,
  phoneNumber: string,
  channel: Channel,
): Promise<string | null> {
  if (!config.greetingFn) return null;
  try {
    return (await config.greetingFn(phoneNumber, channel)) ?? null;
  } catch (error) {
    logger.error("greetingFn error, using phrase greeting", {
      phoneNumber,
      channel,
      error: getErrorMessage(error),
    });
    return null;
  }
}

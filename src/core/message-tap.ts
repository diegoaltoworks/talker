/**
 * Message Tap
 *
 * Fires `TalkerConfig.onMessage` for every inbound message and outbound
 * reply across all channels. Fire-and-forget: a throwing or slow handler is
 * logged and never affects message delivery.
 */

import type { MessageTapEvent, TalkerConfig } from "../types";
import { getErrorMessage } from "./errors";
import { logger } from "./logger";

export function emitMessageTap(
  config: TalkerConfig,
  event: Omit<MessageTapEvent, "timestamp">,
): void {
  const handler = config.onMessage;
  if (!handler) return;

  const fullEvent: MessageTapEvent = { ...event, timestamp: Date.now() };
  Promise.resolve()
    .then(() => handler(fullEvent))
    .catch((error) => {
      logger.error("onMessage tap error", {
        direction: fullEvent.direction,
        channel: fullEvent.channel,
        error: getErrorMessage(error),
      });
    });
}

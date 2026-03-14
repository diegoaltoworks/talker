/**
 * Call Status Handler
 *
 * Handles POST /call/status — called by Twilio when call state changes.
 * Cleans up conversation context when call completes.
 */

import type { Context } from "hono";
import { clearContext } from "../../core/context";
import { logger } from "../../core/logger";

export async function handleStatus(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const callStatus = body.CallStatus as string;

  logger.info("call status update", { phoneNumber, callStatus });

  if (callStatus === "completed") {
    clearContext(phoneNumber);
  }

  return c.text("", 200);
}

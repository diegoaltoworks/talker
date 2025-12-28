/**
 * Call Status Handler
 *
 * Handles POST /call/status — called by Twilio when call state changes.
 * Persists the final session state, then cleans up conversation context.
 */

import type { Context } from "hono";
import { clearContext } from "../../core/context";
import { logger } from "../../core/logger";
import { persistFinalSession, persistSession } from "../../db/persist";

export async function handleStatus(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const phoneNumber = ((body.From as string) || "unknown").trim();
  const callStatus = body.CallStatus as string;

  logger.info("call status update", { phoneNumber, callStatus });

  if (callStatus === "completed") {
    // Final save — persist all messages and mark session as ended
    persistSession(phoneNumber, "call");
    persistFinalSession(phoneNumber, "call", "ended");
    clearContext(phoneNumber);
  }

  return c.text("", 200);
}

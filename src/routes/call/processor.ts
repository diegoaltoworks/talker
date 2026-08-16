/**
 * Call Processor
 *
 * End-to-end processing pipeline for a single voice call interaction:
 * incoming pre-processing -> flow check -> chatbot -> outgoing post-processing -> TwiML
 */

import { chat } from "../../core/chat";
import { clearContext } from "../../core/context";
import { logger } from "../../core/logger";
import { emitMessageTap } from "../../core/message-tap";
import { getFarewellPhrase, getPhrase } from "../../core/phrases";
import { processIncoming, processOutgoing } from "../../core/processing";
import { farewellTwiml, gatherTwiml, transferTwiml } from "../../core/twiml";
import { persistFinalSession, persistSession } from "../../db/persist";
import { processFlow } from "../../flows/manager";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";

/**
 * Process a call interaction and generate TwiML response
 */
export async function processCall(
  deps: TalkerDependencies,
  registry: FlowRegistry,
  phoneNumber: string,
  speechResult: string,
  to: string,
): Promise<string> {
  const incoming = await processIncoming(deps, phoneNumber, speechResult, "call");

  const tapOutbound = (body: string) =>
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel: "call",
      from: to,
      to: phoneNumber,
      body,
    });

  // Transfer to human if requested
  if (incoming.shouldTransfer) {
    logger.info("transferring to human", { phoneNumber, language: incoming.detectedLanguage });
    await persistSession(phoneNumber, "call", deps.store);
    persistFinalSession(phoneNumber, "call", "redirected", incoming.processedMessage, deps.store);
    // transferTwiml <Dial>s straight to a human with no further <Gather> -
    // talker won't be asked to handle this call again, same as the
    // shouldEndCall branch below. Clearing the context here (not just
    // relying on the caller's own post-response persistSession call) stops
    // that unconditional call from re-upserting reason:"ended" over the
    // "redirected" write just above once the context it reads is gone.
    clearContext(phoneNumber);
    const message = getPhrase(incoming.detectedLanguage, "transfer", deps.config.languageDir);
    tapOutbound(message);
    return transferTwiml(incoming.detectedLanguage, deps.config, message);
  }

  // End call politely if user is done
  if (incoming.shouldEndCall) {
    logger.info("ending call - user done", { phoneNumber, language: incoming.detectedLanguage });
    await persistSession(phoneNumber, "call", deps.store);
    persistFinalSession(phoneNumber, "call", "ended", undefined, deps.store);
    clearContext(phoneNumber);
    const message = getFarewellPhrase(incoming.detectedLanguage, deps.config.languageDir);
    tapOutbound(message);
    return farewellTwiml(incoming.detectedLanguage, deps.config, message);
  }

  // Check if message triggers or continues a flow
  const flowResult = await processFlow(
    deps,
    registry,
    phoneNumber,
    incoming.processedMessage,
    "call",
  );

  if (
    flowResult.isFlowActive ||
    flowResult.flowCompleted ||
    flowResult.cancelled ||
    flowResult.error
  ) {
    logger.info("FLOW RESULT", {
      phoneNumber,
      active: flowResult.isFlowActive,
      done: flowResult.flowCompleted,
      success: flowResult.flowSuccess,
      cancelled: flowResult.cancelled,
      error: flowResult.error,
    });

    // If flow completed but failed, transfer to human
    if (flowResult.flowCompleted && flowResult.flowSuccess === false) {
      await persistSession(phoneNumber, "call", deps.store);
      persistFinalSession(phoneNumber, "call", "redirected", flowResult.response, deps.store);
      // Same reasoning as the shouldTransfer branch above: this call also
      // ends in a <Dial> with no further <Gather>, so clear the context here
      // rather than leaving it for the caller's own post-response
      // persistSession to unconditionally overwrite "redirected" with "ended".
      clearContext(phoneNumber);
      tapOutbound(flowResult.response);
      return transferTwiml(incoming.detectedLanguage, deps.config, flowResult.response);
    }

    tapOutbound(flowResult.response);
    return gatherTwiml(flowResult.response, incoming.detectedLanguage, deps.config, phoneNumber);
  }

  // Get chatbot response
  const botResponse = await chat(deps, phoneNumber, incoming.processedMessage, "call");
  const phoneResponse = await processOutgoing(deps, phoneNumber, botResponse, "call");

  tapOutbound(phoneResponse);
  return gatherTwiml(phoneResponse, incoming.detectedLanguage, deps.config, phoneNumber);
}

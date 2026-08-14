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
import { getVoiceConfig } from "../../core/voice";
import { escapeXml } from "../../core/xml";
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
    persistSession(phoneNumber, "call");
    persistFinalSession(phoneNumber, "call", "redirected", incoming.processedMessage);
    const message = getPhrase(incoming.detectedLanguage, "transfer", deps.config.languageDir);
    tapOutbound(message);
    return transferTwiml(incoming.detectedLanguage, deps.config, message);
  }

  // End call politely if user is done
  if (incoming.shouldEndCall) {
    logger.info("ending call - user done", { phoneNumber, language: incoming.detectedLanguage });
    persistSession(phoneNumber, "call");
    persistFinalSession(phoneNumber, "call", "ended");
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

  if (flowResult.isFlowActive || flowResult.flowCompleted) {
    logger.info("FLOW RESULT", {
      phoneNumber,
      active: flowResult.isFlowActive,
      done: flowResult.flowCompleted,
      success: flowResult.flowSuccess,
    });

    // If flow completed but failed, transfer to human
    if (flowResult.flowCompleted && flowResult.flowSuccess === false) {
      const { voice, language: lang } = getVoiceConfig(
        incoming.detectedLanguage,
        deps.config.voices,
      );
      const transferNumber = deps.config.transferNumber || "";
      const escapedFlowResponse = escapeXml(flowResult.response);
      tapOutbound(flowResult.response);
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${escapedFlowResponse}</Say>
    <Dial>${transferNumber}</Dial>
</Response>`;
    }

    const escapedResponse = escapeXml(flowResult.response);
    tapOutbound(flowResult.response);
    return gatherTwiml(escapedResponse, incoming.detectedLanguage, deps.config, phoneNumber);
  }

  // Get chatbot response
  const botResponse = await chat(deps, phoneNumber, incoming.processedMessage);
  const phoneResponse = await processOutgoing(deps, phoneNumber, botResponse, "call");
  const escapedResponse = escapeXml(phoneResponse);

  tapOutbound(phoneResponse);
  return gatherTwiml(escapedResponse, incoming.detectedLanguage, deps.config, phoneNumber);
}

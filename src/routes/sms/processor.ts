/**
 * SMS Processor
 *
 * End-to-end processing pipeline for a single SMS interaction.
 */

import { chat } from "../../core/chat";
import { getSmsPhrase } from "../../core/phrases";
import { processIncoming, processOutgoing } from "../../core/processing";
import { messageTwiml } from "../../core/twiml";
import { processFlow } from "../../flows/manager";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";

/**
 * Process an SMS interaction and generate TwiML response
 */
export async function processSms(
  deps: TalkerDependencies,
  registry: FlowRegistry,
  phoneNumber: string,
  messageBody: string,
): Promise<string> {
  const incoming = await processIncoming(deps, phoneNumber, messageBody, "sms");

  // If user wants to talk to a human, give them guidance
  if (incoming.shouldTransfer) {
    const message = getSmsPhrase(incoming.detectedLanguage, "callForHelp", deps.config.languageDir);
    return messageTwiml(message);
  }

  // Check if message triggers or continues a flow
  const flowResult = await processFlow(
    deps,
    registry,
    phoneNumber,
    incoming.processedMessage,
    "sms",
  );

  if (flowResult.isFlowActive || flowResult.flowCompleted) {
    if (flowResult.flowCompleted && flowResult.flowSuccess === false) {
      const message = getSmsPhrase(
        incoming.detectedLanguage,
        "processingError",
        deps.config.languageDir,
      );
      return messageTwiml(message);
    }
    return messageTwiml(flowResult.response);
  }

  // Get chatbot response
  const botResponse = await chat(deps, phoneNumber, incoming.processedMessage);
  const smsResponse = await processOutgoing(deps, phoneNumber, botResponse, "sms");

  return messageTwiml(smsResponse);
}

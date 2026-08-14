/**
 * WhatsApp Processor
 *
 * End-to-end processing pipeline for a single WhatsApp interaction.
 * Mirrors the SMS processor but uses the "whatsapp" channel for
 * channel-aware formatting (richer content, longer messages).
 */

import { chat } from "../../core/chat";
import { emitMessageTap } from "../../core/message-tap";
import { getWhatsAppPhrase } from "../../core/phrases";
import { processIncoming, processOutgoing } from "../../core/processing";
import { messageTwiml } from "../../core/twiml";
import { processFlow } from "../../flows/manager";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";

/**
 * Process a WhatsApp interaction and generate TwiML response
 */
export async function processWhatsApp(
  deps: TalkerDependencies,
  registry: FlowRegistry,
  phoneNumber: string,
  messageBody: string,
  to: string,
): Promise<string> {
  const incoming = await processIncoming(deps, phoneNumber, messageBody, "whatsapp");

  const tapOutbound = (body: string) =>
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel: "whatsapp",
      from: to,
      to: phoneNumber,
      body,
    });

  // If user wants to talk to a human, give them guidance
  if (incoming.shouldTransfer) {
    const message = getWhatsAppPhrase(
      incoming.detectedLanguage,
      "callForHelp",
      deps.config.languageDir,
    );
    tapOutbound(message);
    return messageTwiml(message);
  }

  // Check if message triggers or continues a flow
  const flowResult = await processFlow(
    deps,
    registry,
    phoneNumber,
    incoming.processedMessage,
    "whatsapp",
  );

  if (flowResult.isFlowActive || flowResult.flowCompleted) {
    if (flowResult.flowCompleted && flowResult.flowSuccess === false) {
      const message = getWhatsAppPhrase(
        incoming.detectedLanguage,
        "processingError",
        deps.config.languageDir,
      );
      tapOutbound(message);
      return messageTwiml(message);
    }
    const content = flowResult.whatsappContent || flowResult.response;
    tapOutbound(content);
    return messageTwiml(content);
  }

  // Get chatbot response
  const botResponse = await chat(deps, phoneNumber, incoming.processedMessage);
  const whatsappResponse = await processOutgoing(deps, phoneNumber, botResponse, "whatsapp");

  tapOutbound(whatsappResponse);
  return messageTwiml(whatsappResponse);
}

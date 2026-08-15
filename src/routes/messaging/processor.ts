/**
 * Messaging Processor
 *
 * End-to-end processing pipeline for a single SMS or WhatsApp interaction.
 * SMS and WhatsApp share the same Twilio payload shape and TwiML response
 * format; only the phrase namespace and the flow's channel-specific content
 * field differ.
 */

import { chat } from "../../core/chat";
import { emitMessageTap } from "../../core/message-tap";
import { getChannelPhrase } from "../../core/phrases";
import { processIncoming, processOutgoing } from "../../core/processing";
import { messageTwiml } from "../../core/twiml";
import { processFlow } from "../../flows/manager";
import type { FlowRegistry } from "../../flows/registry";
import type { TalkerDependencies } from "../../types";

export type MessagingChannel = "sms" | "whatsapp";

/**
 * Process an SMS or WhatsApp interaction and generate TwiML response
 */
export async function processMessage(
  deps: TalkerDependencies,
  registry: FlowRegistry,
  phoneNumber: string,
  messageBody: string,
  to: string,
  channel: MessagingChannel,
): Promise<string> {
  const incoming = await processIncoming(deps, phoneNumber, messageBody, channel);

  const tapOutbound = (body: string) =>
    emitMessageTap(deps.config, {
      direction: "outbound",
      channel,
      from: to,
      to: phoneNumber,
      body,
    });

  // If user wants to talk to a human, give them guidance
  if (incoming.shouldTransfer) {
    const message = getChannelPhrase(
      channel,
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
    channel,
  );

  if (
    flowResult.isFlowActive ||
    flowResult.flowCompleted ||
    flowResult.cancelled ||
    flowResult.error
  ) {
    if (flowResult.flowCompleted && flowResult.flowSuccess === false) {
      const message = getChannelPhrase(
        channel,
        incoming.detectedLanguage,
        "processingError",
        deps.config.languageDir,
      );
      tapOutbound(message);
      return messageTwiml(message);
    }
    const channelContent = channel === "sms" ? flowResult.smsContent : flowResult.whatsappContent;
    const content = channelContent || flowResult.response;
    tapOutbound(content);
    return messageTwiml(content);
  }

  // Get chatbot response
  const botResponse = await chat(deps, phoneNumber, incoming.processedMessage, channel);
  const response = await processOutgoing(deps, phoneNumber, botResponse, channel);

  tapOutbound(response);
  return messageTwiml(response);
}

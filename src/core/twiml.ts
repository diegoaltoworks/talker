/**
 * TwiML Generation Utilities
 *
 * Generates Twilio Markup Language (TwiML) XML for voice and SMS responses.
 */

import type { TalkerConfig, VoiceConfig } from "../types";
import { setLastPrompt } from "./context";
import { getFarewellPhrase, getPhrase } from "./phrases";
import { getVoiceConfig } from "./voice";
import { escapeXml } from "./xml";

/**
 * Generate TwiML for a speech gather with response
 */
export function gatherTwiml(
  prompt: string,
  language: string,
  config: TalkerConfig,
  phoneNumber?: string,
): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const prefix = config.routePrefix || "";

  if (phoneNumber) {
    setLastPrompt(phoneNumber, prompt);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${prompt}</Say>
    <Gather input="speech" action="${prefix}/call/respond" method="POST" speechTimeout="auto" language="${lang}">
    </Gather>
    <Redirect method="POST">${prefix}/call/no-speech</Redirect>
</Response>`;
}

/**
 * Generate TwiML for a simple say
 */
export function sayTwiml(message: string, language: string, config: TalkerConfig): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${message}</Say>
</Response>`;
}

/**
 * Generate TwiML for transferring to a human
 */
export function transferTwiml(language: string, config: TalkerConfig): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const message = getPhrase(language, "transfer", config.languageDir);
  const transferNumber = config.transferNumber || "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${message}</Say>
    <Dial>${transferNumber}</Dial>
</Response>`;
}

/**
 * Generate TwiML for the "one moment please" acknowledgment
 */
export function acknowledgmentTwiml(language: string, config: TalkerConfig): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const message = getPhrase(language, "acknowledgment", config.languageDir);
  const prefix = config.routePrefix || "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${message}</Say>
    <Redirect method="POST">${prefix}/call/answer</Redirect>
</Response>`;
}

/**
 * Generate TwiML for ending a call with a farewell
 */
export function farewellTwiml(language: string, config: TalkerConfig): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const message = getFarewellPhrase(language, config.languageDir);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${lang}">${message}</Say>
    <Hangup/>
</Response>`;
}

/**
 * Generate TwiML for an SMS response
 */
export function messageTwiml(message: string): string {
  const escapedMessage = escapeXml(message);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>${escapedMessage}</Message>
</Response>`;
}

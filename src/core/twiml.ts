/**
 * TwiML Generation Utilities
 *
 * Generates Twilio Markup Language (TwiML) XML for voice and SMS responses.
 *
 * Every helper escapes what it interpolates. Callers pass plain text and
 * never pre-escape: an already-escaped string would be double-escaped here
 * and read out as "ampersand a m p semicolon".
 */

import type { Context } from "hono";
import type { TalkerConfig } from "../types";
import { CALL_ANSWER_PATH, CALL_NO_SPEECH_PATH, CALL_RESPOND_PATH } from "./call-paths";
import { setLastPrompt } from "./context";
import { getFarewellPhrase, getPhrase } from "./phrases";
import { getVoiceConfig } from "./voice";
import { escapeXml } from "./xml";

/**
 * Send a TwiML response with the headers Twilio expects. Every route handler
 * that returns TwiML goes through this - a bare `c.text(xml, 200, {...})` at
 * each call site is how the content-type header drifted before.
 */
export function twimlResponse(c: Context, xml: string, status: 200 | 429 = 200): Response {
  return c.text(xml, status, { "Content-Type": "text/xml" });
}

/**
 * Generate TwiML for a speech gather with response.
 *
 * `prompt` is stored unescaped as the last prompt so the no-speech retry can
 * re-speak it (and re-escape it) without stacking entities. `Say` is nested
 * inside `Gather` so speech recognition starts as soon as the prompt begins
 * playing, letting a caller barge in instead of waiting it out.
 */
export function gatherTwiml(
  prompt: string,
  language: string,
  config: TalkerConfig,
  phoneNumber?: string,
): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const prefix = escapeXml(config.routePrefix || "");

  if (phoneNumber) {
    setLastPrompt(phoneNumber, prompt);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${prefix}${CALL_RESPOND_PATH}" method="POST" speechTimeout="auto" language="${escapeXml(lang)}">
        <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(prompt)}</Say>
    </Gather>
    <Redirect method="POST">${prefix}${CALL_NO_SPEECH_PATH}</Redirect>
</Response>`;
}

/**
 * Generate TwiML for a simple say
 */
export function sayTwiml(message: string, language: string, config: TalkerConfig): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(message)}</Say>
</Response>`;
}

/**
 * Generate TwiML for transferring to a human.
 * Pass `message` when the caller already resolved the phrase (e.g. to tap
 * the exact text delivered) - otherwise it's looked up here, which can pick
 * a different variant than a caller-side lookup when the phrase rotates.
 */
export function transferTwiml(language: string, config: TalkerConfig, message?: string): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const resolvedMessage = message ?? getPhrase(language, "transfer", config.languageDir);
  const transferNumber = config.transferNumber || "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(resolvedMessage)}</Say>
    <Dial>${escapeXml(transferNumber)}</Dial>
</Response>`;
}

/**
 * Generate TwiML for the "one moment please" acknowledgment.
 * See `transferTwiml` for the `message` override rationale.
 */
export function acknowledgmentTwiml(
  language: string,
  config: TalkerConfig,
  message?: string,
): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const resolvedMessage = message ?? getPhrase(language, "acknowledgment", config.languageDir);
  const prefix = escapeXml(config.routePrefix || "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(resolvedMessage)}</Say>
    <Redirect method="POST">${prefix}${CALL_ANSWER_PATH}</Redirect>
</Response>`;
}

/**
 * Generate TwiML for ending a call with a farewell.
 * See `transferTwiml` for the `message` override rationale.
 */
export function farewellTwiml(language: string, config: TalkerConfig, message?: string): string {
  const { voice, language: lang } = getVoiceConfig(language, config.voices);
  const resolvedMessage = message ?? getFarewellPhrase(language, config.languageDir);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(resolvedMessage)}</Say>
    <Hangup/>
</Response>`;
}

/**
 * Generate TwiML for an SMS response
 */
export function messageTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>${escapeXml(message)}</Message>
</Response>`;
}

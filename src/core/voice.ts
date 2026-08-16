/**
 * Voice configuration for different languages
 *
 * Maps language codes to TTS voice identifiers and BCP-47 language tags.
 * Default configuration uses Amazon Polly voices via Twilio.
 */

import type { VoiceConfig } from "../types";

const DEFAULT_VOICES: Record<string, VoiceConfig> = {
  en: { voice: "Polly.Brian", language: "en-GB" },
  fr: { voice: "Polly.Mathieu", language: "fr-FR" },
  nl: { voice: "Polly.Ruben", language: "nl-NL" },
  de: { voice: "Polly.Hans", language: "de-DE" },
  es: { voice: "Polly.Enrique", language: "es-ES" },
  pt: { voice: "Polly.Ricardo", language: "pt-BR" },
};

const DEFAULT_VOICE = DEFAULT_VOICES.en;

/**
 * Get voice configuration for a language, with optional custom overrides.
 *
 * Both maps are read with `Object.hasOwn`: the language is caller-influenced,
 * and a plain `[language]` index resolves inherited keys like `constructor`
 * to a non-`VoiceConfig` value, which reaches TwiML as an undefined voice and
 * breaks speech for the rest of the session.
 */
export function getVoiceConfig(
  language: string,
  customVoices?: Record<string, VoiceConfig>,
): VoiceConfig {
  if (customVoices && Object.hasOwn(customVoices, language)) {
    const custom = customVoices[language];
    if (custom) return custom;
  }
  if (Object.hasOwn(DEFAULT_VOICES, language)) {
    const voice = DEFAULT_VOICES[language];
    if (voice) return voice;
  }
  return DEFAULT_VOICE;
}

/**
 * Get the default voice map (useful for consumers who want to extend it)
 */
export function getDefaultVoices(): Record<string, VoiceConfig> {
  return { ...DEFAULT_VOICES };
}

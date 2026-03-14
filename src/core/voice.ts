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
 * Get voice configuration for a language, with optional custom overrides
 */
export function getVoiceConfig(
  language: string,
  customVoices?: Record<string, VoiceConfig>,
): VoiceConfig {
  if (customVoices?.[language]) {
    return customVoices[language];
  }
  return DEFAULT_VOICES[language] || DEFAULT_VOICE;
}

/**
 * Get the default voice map (useful for consumers who want to extend it)
 */
export function getDefaultVoices(): Record<string, VoiceConfig> {
  return { ...DEFAULT_VOICES };
}

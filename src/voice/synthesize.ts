/**
 * Text → voice-note synthesis (OpenAI TTS).
 *
 * Channel-agnostic and framework-free: every dependency (client, enablement,
 * voice mapping, instructions) is injected by the host, so this module never
 * reads `process.env` and never imports a transport.
 *
 * Distinct from `src/core/voice.ts`, which maps languages to Twilio/Polly
 * voice identifiers for phone-call TwiML. This module produces Ogg/Opus audio
 * bytes for voice-note style delivery.
 *
 * TTS with `response_format: "opus"` returns mono Ogg/Opus and the duration
 * falls out of the container (see `ogg.ts`). The synthesizer validates both — a
 * non-mono or unparseable response is refused rather than delivered as a
 * broken bubble.
 */

import type OpenAI from "openai";
import { logger } from "../core/logger";
import { parseOggOpus } from "./ogg";

export interface VoiceNote {
  /** Mono Ogg/Opus bytes, sendable as-is with mimetype `audio/ogg; codecs=opus`. */
  bytes: Uint8Array;
  /** Whole seconds for the voice-note bubble, parsed from the Ogg container. */
  seconds: number;
}

export interface SynthesizeOptions {
  /** Persona id — the host's `voiceFor` decides what it means. */
  personaId?: string | null;
  /** Extra delivery steering appended to the configured base instructions. */
  instructions?: string;
}

export interface SynthesizerConfig {
  /** Lazy OpenAI client — injected so this module never reads env. */
  client: () => OpenAI;
  /** Master gate; false makes the synthesizer a no-op null. */
  enabled: () => boolean;
  /** TTS model. */
  model?: string;
  /** Voice for a persona id (host-owned mapping). */
  voiceFor?: (personaId: string | null | undefined) => string;
  /** Base delivery instructions prepended to every request. */
  baseInstructions?: string;
  /** Input text clamp — long voice notes are a poor listening experience. */
  maxChars?: number;
  /** Playback speed multiplier (OpenAI speech `speed`, 0.25–4). Default 1. */
  speed?: number;
}

export const DEFAULT_MAX_VOICE_TEXT_CHARS = 550;
const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "ash";

/** Synthesize text into a voice note, or null when it cannot be delivered. */
export type Synthesizer = (text: string, options?: SynthesizeOptions) => Promise<VoiceNote | null>;

/**
 * Build a synthesizer: text → VoiceNote | null.
 *
 * Returns null (never throws) when disabled, when the text is empty, or when
 * synthesis or container validation fails — callers always have a text
 * fallback available.
 */
export function createSynthesizer(config: SynthesizerConfig): Synthesizer {
  const maxChars = config.maxChars ?? DEFAULT_MAX_VOICE_TEXT_CHARS;

  return async function synthesize(text, options = {}) {
    if (!config.enabled()) return null;
    const input = text.trim().slice(0, maxChars);
    if (!input) return null;

    try {
      const voice = config.voiceFor?.(options.personaId) ?? DEFAULT_VOICE;
      const response = await config.client().audio.speech.create({
        model: config.model ?? DEFAULT_MODEL,
        // The SDK types `voice` as a closed union of its own presets; the set
        // is host-configurable here, so widen through one of its members.
        voice: voice as "ash",
        input,
        response_format: "opus",
        speed: config.speed ?? 1,
        instructions: [config.baseInstructions ?? "", options.instructions ?? ""]
          .filter(Boolean)
          .join(" "),
      });

      const bytes = new Uint8Array(await response.arrayBuffer());
      const parsed = parseOggOpus(bytes);
      if (!parsed) {
        logger.warn("voice: TTS output was not parseable Ogg/Opus - refusing", {
          bytes: bytes.length,
        });
        return null;
      }
      if (parsed.channels !== 1) {
        // Voice-note bubbles require strict mono; refuse rather than send
        // audio some clients will not play.
        logger.warn("voice: TTS output was not mono - refusing", { channels: parsed.channels });
        return null;
      }

      logger.info("voice: synthesized", { bytes: bytes.length, seconds: parsed.seconds });
      return { bytes, seconds: parsed.seconds };
    } catch (error) {
      logger.warn("voice: synthesis failed", { error: String(error) });
      return null;
    }
  };
}

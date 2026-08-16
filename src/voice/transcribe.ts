/**
 * Voice-note speech-to-text (OpenAI transcription).
 *
 * Same injection shape as `synthesize.ts`: the client, model and clamp come
 * from the host, so nothing here reads env or imports a transport.
 *
 * Contract mirrors the synthesizer: null on ANY failure (disabled, empty
 * audio, API error, empty transcript), never a throw — callers fall back to a
 * text reply rather than silence.
 *
 * `openai` is only ever imported as a type. The upload is built from the
 * platform `File` global rather than the SDK's `toFile` helper, which would be
 * a value import and make an optional peer dependency load-bearing at module
 * load time.
 */

import type OpenAI from "openai";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import { truncateGraphemeSafe } from "../core/text";

export interface TranscriberConfig {
  /** Lazy OpenAI client — injected so this module never reads env. */
  client: () => OpenAI;
  /** Master gate; false makes the transcriber a no-op null. */
  enabled: () => boolean;
  /** Transcription model. */
  model?: string;
  /** Clamp on the returned transcript before it enters the answer path. */
  maxChars?: number;
}

export const DEFAULT_TRANSCRIPT_MAX_CHARS = 2000;
const DEFAULT_MODEL = "gpt-4o-mini-transcribe";

/** Transcribe audio bytes, or null when no usable transcript came back. */
export type Transcriber = (bytes: Uint8Array) => Promise<string | null>;

/**
 * Build a transcriber: Ogg/Opus bytes → transcript | null.
 *
 * The model auto-detects the spoken language, so no language hint is needed.
 */
export function createTranscriber(config: TranscriberConfig): Transcriber {
  const maxChars = config.maxChars ?? DEFAULT_TRANSCRIPT_MAX_CHARS;

  return async function transcribe(bytes) {
    // Everything is inside the try, including the gate and the client factory:
    // both are host callbacks, and a throw from either would break the
    // null-not-throw contract the text fallback depends on.
    try {
      if (!config.enabled()) return null;
      if (bytes.length === 0) return null;

      // Copy into a plain ArrayBuffer: a Uint8Array may be backed by shared or
      // pooled memory, which is neither a valid BlobPart nor safe to hand to an
      // upload that outlives this call.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);

      const result = await config.client().audio.transcriptions.create({
        file: new File([buffer], "voice.ogg", { type: "audio/ogg" }),
        model: config.model ?? DEFAULT_MODEL,
      });

      const text = (result.text ?? "").trim();
      if (!text) return null;

      logger.info("voice: transcribed", { bytes: bytes.length, chars: text.length });
      return truncateGraphemeSafe(text, maxChars);
    } catch (error) {
      logger.warn("voice: transcription failed", { error: getErrorMessage(error) });
      return null;
    }
  };
}

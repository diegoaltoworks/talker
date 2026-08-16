/**
 * Voice capabilities — speech-to-text, text-to-speech, Ogg/Opus inspection and
 * daily spend guards.
 *
 * These are channel-agnostic functions, not route options: a host wires them
 * into whichever transport it runs (Twilio webhooks, a socket-based worker, a
 * custom adapter) by calling the factories directly. Every client is injected,
 * so nothing here reads env or requires `openai` at module load.
 */

export type { VoiceReplyDeps, VoiceReplyOutcome, VoiceReplyPhrases } from "./ladder";
export { runVoiceReply } from "./ladder";
export type {
  VoiceLimitCheck,
  VoiceLimiter,
  VoiceLimiterDeps,
  VoiceLimitReason,
  VoiceLimitsConfig,
  VoiceLimitsEnv,
  VoiceLimitsStore,
} from "./limits";
// GLOBAL_LIMIT_KEY, pickDailyLimit and utcDayKey are internal helpers of
// ./limits (see their @deprecated tags there) re-exported here only because
// this barrel re-exports the whole module; they are candidates for removal
// from this barrel in a future release.
export {
  createVoiceLimiter,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  DEFAULT_PER_NUMBER_DAILY_LIMIT,
  GLOBAL_LIMIT_KEY,
  pickDailyLimit,
  resolveVoiceLimitsConfig,
  utcDayKey,
} from "./limits";
export type { OggOpusInfo } from "./ogg";
export { parseOggOpus } from "./ogg";
export type { SynthesizeOptions, Synthesizer, SynthesizerConfig, VoiceNote } from "./synthesize";
export { createSynthesizer, DEFAULT_MAX_VOICE_TEXT_CHARS } from "./synthesize";
export type { Transcriber, TranscriberConfig } from "./transcribe";
export { createTranscriber, DEFAULT_TRANSCRIPT_MAX_CHARS } from "./transcribe";

/**
 * Voice-note reply ladder — reserve → download → transcribe → answer →
 * synthesize → voice-or-text.
 *
 * Channel-agnostic and framework-free like the rest of `src/voice/`: every
 * step is injected by the host, so this module carries no Twilio/webhook/chat
 * types and never reads env. Persona is entirely the host's concern (folded
 * into `answer` and `synthesize`) — this module knows nothing about it.
 *
 * THE INVARIANT: every branch attempts a delivered message. Voice is
 * attempted, text is guaranteed. A gate (is this sender eligible, is this
 * really a voice note) is the caller's job — the ladder starts after the
 * decision to reply.
 *
 * `sendText` is deliberately never wrapped in try/catch here: a failure to
 * deliver even the guaranteed fallback is not something this module can
 * paper over, so it propagates to the caller rather than resolving to a
 * silent "undeliverable" outcome.
 */

import type { VoiceLimitCheck } from "./limits";
import type { VoiceNote } from "./synthesize";

/** What actually happened, for logging and for tests to assert the ladder. */
export type VoiceReplyOutcome =
  | "over-cap"
  | "limit-error"
  | "no-audio"
  | "transcribe-failed"
  | "answer-failed"
  | "voice"
  | "text";

/**
 * Pre-resolved fallback copy for one call. Resolve these fresh per invocation
 * (e.g. via `getVoicePhrase`) rather than caching the object: any array
 * variant in the phrase file rotates at resolution time, so reusing a built
 * object across calls silently freezes it on one variant.
 */
export interface VoiceReplyPhrases {
  overCapPerNumber: string;
  overCapGlobal: string;
  limitUnavailable: string;
  unintelligible: string;
  answerFailed: string;
}

export interface VoiceReplyDeps {
  /** Reserve one round-trip BEFORE any paid work. A rejection fails closed to text. */
  reserve(): Promise<VoiceLimitCheck>;
  /** Pull the raw audio bytes for the inbound voice note. */
  download(): Promise<Uint8Array>;
  /** Bytes → transcript, or null on any failure. */
  transcribe(bytes: Uint8Array): Promise<string | null>;
  /** The existing answer path — persona, RAG, everything applies to spoken questions too. */
  answer(transcript: string): Promise<string>;
  /** Text → voice note, or null when it can't be produced. */
  synthesize(text: string): Promise<VoiceNote | null>;
  /** Speak the reply; false means "couldn't", and the caller falls back to text. */
  sendVoice(note: VoiceNote): Promise<boolean>;
  /** The guaranteed path. Failures here propagate — see module doc. */
  sendText(text: string): Promise<void>;
  phrases: VoiceReplyPhrases;
}

/**
 * Run the ladder for one eligible voice note. Eligibility (flag, trigger
 * rules, per-sender/group gates) is the caller's job — by the time this runs,
 * the decision to reply has been made and the only question is how.
 */
export async function runVoiceReply(deps: VoiceReplyDeps): Promise<VoiceReplyOutcome> {
  let limit: VoiceLimitCheck;
  try {
    limit = await deps.reserve();
  } catch {
    // Fail closed to text: without a working counter we will not spend.
    await deps.sendText(deps.phrases.limitUnavailable);
    return "limit-error";
  }
  if (!limit.allowed) {
    const phrase =
      limit.reason === "global" ? deps.phrases.overCapGlobal : deps.phrases.overCapPerNumber;
    await deps.sendText(phrase);
    return "over-cap";
  }

  let bytes: Uint8Array;
  try {
    bytes = await deps.download();
  } catch {
    await deps.sendText(deps.phrases.unintelligible);
    return "no-audio";
  }
  if (bytes.length === 0) {
    await deps.sendText(deps.phrases.unintelligible);
    return "no-audio";
  }

  // The transcriber's own contract is "never throws", but the ladder does not
  // trust its injections: a throw escaping here would otherwise skip the text
  // fallback entirely.
  let transcript: string | null = null;
  try {
    transcript = await deps.transcribe(bytes);
  } catch {
    transcript = null;
  }
  if (!transcript) {
    await deps.sendText(deps.phrases.unintelligible);
    return "transcribe-failed";
  }

  let reply: string;
  try {
    reply = await deps.answer(transcript);
  } catch {
    await deps.sendText(deps.phrases.answerFailed);
    return "answer-failed";
  }
  if (!reply.trim()) {
    await deps.sendText(deps.phrases.answerFailed);
    return "answer-failed";
  }

  let note: VoiceNote | null = null;
  try {
    note = await deps.synthesize(reply);
  } catch {
    note = null;
  }

  let spoken = false;
  if (note) {
    try {
      spoken = await deps.sendVoice(note);
    } catch {
      spoken = false;
    }
  }
  if (spoken) return "voice";

  await deps.sendText(reply);
  return "text";
}

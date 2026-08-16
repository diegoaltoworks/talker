/**
 * Talker — Telephony Plugin for Chatter
 *
 * Adds voice call, SMS, and WhatsApp support to Chatter chatbots via Twilio.
 * Can also run as a standalone telephony server with a custom chatFn.
 *
 * ## Usage as Chatter Plugin
 *
 * ```typescript
 * import { createServer } from "@diegoaltoworks/chatter";
 * import { createTelephonyRoutes } from "@diegoaltoworks/talker";
 *
 * const app = await createServer({
 *   ...chatterConfig,
 *   customRoutes: (app, deps) => {
 *     createTelephonyRoutes(app, deps, {
 *       twilio: { accountSid, authToken, phoneNumber },
 *       transferNumber: "+44...",
 *     });
 *   },
 * });
 * ```
 *
 * ## Usage as Standalone Server
 *
 * ```typescript
 * import { createStandaloneServer } from "@diegoaltoworks/talker";
 *
 * const app = await createStandaloneServer({
 *   openaiApiKey: process.env.OPENAI_API_KEY!,
 *   chatFn: async (phone, msg) => myBot.reply(msg),
 * });
 *
 * Bun.serve({ port: 3000, fetch: app.fetch });
 * ```
 *
 * @packageDocumentation
 */

export type { SendMessageOptions } from "./adapters/twilio";
// Twilio adapter
export { sendSMS, sendWhatsApp, stripWhatsAppPrefix } from "./adapters/twilio";
export type { ContextStore, TelephonyContext } from "./core/context";
// clearAllContexts, incrementNoSpeechRetries and resetNoSpeechRetries are
// internal helpers of ./core/context and are deliberately not re-exported
// here: they are call-flow bookkeeping and a test-only reset, not host API.
export {
  addMessage,
  clearActiveFlow,
  clearContext,
  configureContextStore,
  createInMemoryContextStore,
  getActiveFlow,
  getContext,
  getDetectedLanguage,
  getLastPrompt,
  getMessageHistory,
  getOrCreateContext,
  resolveLanguage,
  setActiveFlow,
  setDetectedLanguage,
  setLastPrompt,
  startCleanup,
  stopCleanup,
  updateFlowParams,
} from "./core/context";
export { DEFAULT_LANGUAGE, isValidLanguageCode, normalizeLanguage } from "./core/language";
// Logger
export { logger, redactPhone } from "./core/logger";
export type { Phrases, PhraseValue } from "./core/phrases";
export {
  getCancellationKeywords,
  getChannelPhrase,
  getFarewellPhrase,
  getFlowPhrase,
  getPhrase,
  getSmsPhrase,
  getVoicePhrase,
  getWhatsAppPhrase,
  loadPhrases,
} from "./core/phrases";
// Core modules (for advanced customization)
export {
  getIncomingPrompt,
  getOutgoingPrompt,
  processIncoming,
  processOutgoing,
} from "./core/processing";
export type { IncomingResult } from "./core/processing/incoming";
// TwiML generators
export {
  acknowledgmentTwiml,
  farewellTwiml,
  gatherTwiml,
  messageTwiml,
  sayTwiml,
  transferTwiml,
} from "./core/twiml";
export { getDefaultVoices, getVoiceConfig } from "./core/voice";
export { escapeXml } from "./core/xml";
// Database (session persistence)
export { closeDbClient, getDbClient, initDbClient } from "./db/client";
export { createLibsqlTalkerStore } from "./db/libsql-store";
export { runMigrations } from "./db/migrate";
export { persistFinalSession, persistSession } from "./db/persist";
export { resolveStore } from "./db/resolve-store";
export type { MessageRecord, MessageStatusRecord, SessionRecord, TalkerStore } from "./db/store";
export { createNullTalkerStore } from "./db/store";
export { loadFlowsFromDirectory } from "./flows/loader";
export { processFlow, shouldExitFlow } from "./flows/manager";
// Flow engine
export { FlowRegistry } from "./flows/registry";
export type {
  FlowDefinition,
  FlowExtractionResult,
  FlowHandler,
  FlowHandlerContext,
  FlowHandlerResult,
  FlowPrefill,
  FlowResult,
  FlowSchema,
  FlowSchemaProperty,
  FlowState,
  IntentDetection,
  LoadedFlow,
} from "./flows/types";
export { CURRENT_FLOW_CONTRACT_VERSION, LEGACY_FLOW_CONTRACT_VERSION } from "./flows/types";
export { getExitMessage } from "./flows/utils";
export { inputSanitizeMiddleware, truncateInputMiddleware } from "./middleware/input-sanitize";
export { rateLimitMiddleware, stopRateLimitCleanup } from "./middleware/rate-limit";
// Security middleware
export type { TwilioSignatureOptions } from "./middleware/twilio-signature";
export { twilioSignatureMiddleware, validateTwilioSignature } from "./middleware/twilio-signature";
// Plugin entry point (chatter integration)
export { createTelephonyRoutes } from "./plugin";

// Route factories (for custom setup)
export { callRoutes } from "./routes/call";
export { messagingRoutes } from "./routes/messaging";
export { handleFallback } from "./routes/shared/handle-fallback";
// Shared handlers (for custom route setups)
export { handleStatusCallback } from "./routes/shared/handle-status-callback";
export type { StandaloneConfig } from "./standalone";
// Standalone entry point (no chatter required)
export { createStandaloneServer } from "./standalone";
// Types
export type {
  Channel,
  ChatbotConfig,
  MessageStatusEvent,
  MessageTapEvent,
  MessagingChannel,
  ProcessingConfig,
  TalkerConfig,
  TalkerDependencies,
  TelephonyFeatureFlags,
  TwilioConfig,
  VoiceConfig,
} from "./types";
// Voice capabilities (STT, TTS, Ogg/Opus inspection, daily spend guards).
// Channel-agnostic factories with injected clients — see src/voice/index.ts.
export type {
  OggOpusInfo,
  SynthesizeOptions,
  Synthesizer,
  SynthesizerConfig,
  Transcriber,
  TranscriberConfig,
  VoiceLimitCheck,
  VoiceLimiter,
  VoiceLimiterDeps,
  VoiceLimitReason,
  VoiceLimitsConfig,
  VoiceLimitsEnv,
  VoiceLimitsStore,
  VoiceNote,
  VoiceReplyDeps,
  VoiceReplyOutcome,
  VoiceReplyPhrases,
} from "./voice";
export {
  createSynthesizer,
  createTranscriber,
  createVoiceLimiter,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  DEFAULT_MAX_VOICE_TEXT_CHARS,
  DEFAULT_PER_NUMBER_DAILY_LIMIT,
  DEFAULT_TRANSCRIPT_MAX_CHARS,
  findSuspiciousOggComments,
  parseOggOpus,
  resolveVoiceLimitsConfig,
  runVoiceReply,
} from "./voice";

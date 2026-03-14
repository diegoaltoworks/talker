/**
 * Talker — Telephony Plugin for Chatter
 *
 * Adds voice call and SMS support to Chatter chatbots via Twilio.
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

// Plugin entry point (chatter integration)
export { createTelephonyRoutes } from "./plugin";

// Standalone entry point (no chatter required)
export { createStandaloneServer } from "./standalone";
export type { StandaloneConfig } from "./standalone";

// Types
export type {
  TalkerConfig,
  TalkerDependencies,
  TelephonyFeatureFlags,
  TwilioConfig,
  ChatbotConfig,
  ProcessingConfig,
  Channel,
  VoiceConfig,
  IncomingResult,
  TelephonyContext,
  Phrases,
} from "./types";

// Flow types
export type {
  FlowDefinition,
  FlowSchema,
  FlowSchemaProperty,
  FlowState,
  FlowHandler,
  FlowHandlerResult,
  FlowHandlerContext,
  FlowPrefill,
  FlowExtractionResult,
  FlowResult,
  IntentDetection,
  LoadedFlow,
} from "./types";

// Core modules (for advanced customization)
export { processIncoming, processOutgoing } from "./core/processing";
export { getVoiceConfig, getDefaultVoices } from "./core/voice";
export { escapeXml } from "./core/xml";
export {
  getPhrase,
  getFarewellPhrase,
  getFlowPhrase,
  getSmsPhrase,
  loadPhrases,
} from "./core/phrases";
export {
  getOrCreateContext,
  getContext,
  clearContext,
  clearAllContexts,
  setDetectedLanguage,
  getDetectedLanguage,
  addMessage,
  getMessageHistory,
  setActiveFlow,
  getActiveFlow,
  updateFlowParams,
  clearActiveFlow,
  incrementNoSpeechRetries,
  resetNoSpeechRetries,
  getLastPrompt,
  setLastPrompt,
  startCleanup,
  stopCleanup,
} from "./core/context";

// TwiML generators
export {
  gatherTwiml,
  sayTwiml,
  transferTwiml,
  acknowledgmentTwiml,
  farewellTwiml,
  messageTwiml,
} from "./core/twiml";

// Flow engine
export { FlowRegistry } from "./flows/registry";
export { processFlow, shouldExitFlow } from "./flows/manager";
export { loadFlowsFromDirectory } from "./flows/loader";
export { getExitMessage } from "./flows/utils";

// Twilio adapter
export { sendSMS } from "./adapters/twilio";

// Route factories (for custom setup)
export { callRoutes } from "./routes/call";
export { smsRoutes } from "./routes/sms";

// Logger
export { logger } from "./core/logger";

/**
 * Talker Type Definitions
 *
 * Core types for the Talker telephony plugin.
 * These types define the public API and configuration interface.
 */

import type { ServerDependencies } from "@diegoaltoworks/chatter";

/**
 * Channel type for telephony interactions
 */
export type Channel = "call" | "sms" | "whatsapp";

/**
 * Voice configuration for text-to-speech
 */
export interface VoiceConfig {
  /** TTS voice identifier (e.g., "Polly.Brian") */
  voice: string;
  /** BCP-47 language tag (e.g., "en-GB") */
  language: string;
}

/**
 * Twilio adapter configuration
 */
export interface TwilioConfig {
  /** Twilio account SID */
  accountSid?: string;
  /** Twilio auth token */
  authToken?: string;
  /** Twilio phone number for outbound SMS/WhatsApp */
  phoneNumber?: string;
  /**
   * Twilio Messaging Service SID.
   * When set, outbound messages use MessagingServiceSid instead of From.
   * This enables features like sender pool, sticky sender, and compliance.
   */
  messagingServiceSid?: string;
}

/**
 * Status callback event from Twilio.
 * Received at /sms/status and /whatsapp/status endpoints.
 */
export interface MessageStatusEvent {
  /** Twilio message SID */
  messageSid: string;
  /** Message status: queued, sent, delivered, undelivered, failed, read */
  messageStatus: string;
  /** Channel the message was sent on */
  channel: "sms" | "whatsapp";
  /** Sender phone number */
  from: string;
  /** Recipient phone number */
  to: string;
  /** Twilio error code (if failed/undelivered) */
  errorCode?: string;
  /** Twilio error message (if failed/undelivered) */
  errorMessage?: string;
}

/**
 * Message-tap event, fired for every inbound message and every outbound
 * reply on all channels (call, sms, whatsapp).
 */
export interface MessageTapEvent {
  /** "inbound" for a message received from the user, "outbound" for a reply sent to them */
  direction: "inbound" | "outbound";
  /** Channel the message travelled on */
  channel: Channel;
  /** Sender phone number for this message (bare, no whatsapp: prefix) */
  from: string;
  /** Recipient phone number for this message (bare, no whatsapp: prefix) */
  to: string;
  /** Message text */
  body: string;
  /** Unix ms timestamp when the tap fired */
  timestamp: number;
}

/**
 * Remote chatbot API configuration (standalone mode)
 *
 * When running without chatter, talker calls a remote chatbot API over HTTP.
 * This matches chatter's /api/public/chat endpoint format.
 */
export interface ChatbotConfig {
  /** Chatbot API URL (e.g., "https://bot.example.com/api/public/chat") */
  url: string;
  /** API key for the chatbot (sent as x-api-key header) */
  apiKey?: string;
  /** System message prepended to conversation. Overrides the default */
  systemMessage?: string;
}

/**
 * Processing pipeline configuration
 */
export interface ProcessingConfig {
  /** OpenAI model for pre/post-processing. Default: gpt-4o-mini */
  model?: string;
  /** Path to incoming message system prompt */
  incomingPromptPath?: string;
  /** Path to outgoing message system prompt */
  outgoingPromptPath?: string;
  /**
   * Base URL for the chat completions API the pre/post-processing pipeline
   * calls (an Azure OpenAI deployment, a self-hosted gateway, a proxy).
   * Default: "https://api.openai.com/v1/chat/completions"
   */
  baseUrl?: string;
  /**
   * Abort the pre/post-processing OpenAI request after this many
   * milliseconds. A hung upstream request would otherwise hold the /call,
   * /sms or /whatsapp webhook open indefinitely - callers already treat a
   * failed call as "use the original text unmodified", so aborting is safe.
   * Default: 8000 (8 seconds)
   */
  requestTimeoutMs?: number;
}

/**
 * Feature flags for telephony behavior
 */
export interface TelephonyFeatureFlags {
  /** Enable "one moment please" async acknowledgment pattern. Default: false */
  thinkingAcknowledgmentEnabled?: boolean;
}

/**
 * Main configuration for Talker telephony plugin
 */
export interface TalkerConfig {
  /** Twilio credentials and phone number */
  twilio?: TwilioConfig;

  /**
   * Public URL where webhooks are received (e.g. "https://bot.example.com").
   * Required for Twilio signature validation behind reverse proxies.
   * When not set, falls back to chatter's `bot.publicUrl` in plugin mode,
   * or to `c.req.url` which may use http:// behind a proxy.
   */
  publicUrl?: string;

  /**
   * Mount the webhooks even though no `twilio.authToken` is configured, i.e.
   * without signature validation. Development and local testing only: with this
   * on, anyone who can reach /call, /sms or /whatsapp can impersonate Twilio.
   *
   * Without it, mounting refuses to start when the auth token is missing, and
   * the signature middleware rejects every request with 403. Default: false.
   */
  allowUnsignedWebhooks?: boolean;

  /** Phone number to transfer calls to when human handoff is requested */
  transferNumber?: string;

  /** Voice configuration per language code. Keys are ISO 639-1 codes (e.g., "en", "fr") */
  voices?: Record<string, VoiceConfig>;

  /** Directory containing flow definitions. Each flow is a subdirectory with flow.json, handler.ts, instructions.md */
  flowsDir?: string;

  /** Directory containing language phrase files (en.json, fr.json, etc.) */
  languageDir?: string;

  /** Processing pipeline configuration */
  processing?: ProcessingConfig;

  /** Feature flags */
  features?: TelephonyFeatureFlags;

  /** Remote chatbot API (standalone mode). Not needed in plugin mode — chatter's RAG is used directly */
  chatbot?: ChatbotConfig;

  /** Database config for session persistence. In plugin mode, falls back to chatter's database config */
  database?: {
    /** Turso/libSQL database URL */
    url: string;
    /** Turso auth token */
    authToken: string;
  };

  /** OpenAI API key for the pre/post-processing pipeline. Falls back to chatter's OpenAI client */
  openaiApiKey?: string;

  /** Route prefix for telephony endpoints. Default: "" (mounts at /call, /sms, and /whatsapp) */
  routePrefix?: string;

  /** Conversation context TTL in milliseconds. Default: 1800000 (30 minutes) */
  contextTtlMs?: number;

  /** Context cleanup interval in milliseconds. Default: 300000 (5 minutes) */
  cleanupIntervalMs?: number;

  /**
   * How long an unresolved /call/answer acknowledgment entry is kept before
   * the cleanup sweep discards it (e.g. the caller hangs up before Twilio
   * requests /call/answer). Checked once per `cleanupIntervalMs` tick, so
   * actual lifetime is this value rounded up to the next sweep, not a hard
   * deadline. Keep it comfortably above `callAnswerBudgetMs` - too low and
   * the sweep can delete an entry a still-racing /call/answer needs, which
   * silently downgrades a real answer to the timeout phrase.
   * Default: 60000 (1 minute)
   */
  pendingQueryTtlMs?: number;

  /**
   * Budget for background call processing before /call/answer gives up and
   * speaks a timeout phrase. Must stay well under Twilio's ~15s webhook
   * timeout so the phrase is actually deliverable. Default: 8000 (8 seconds)
   */
  callAnswerBudgetMs?: number;

  /** Maximum no-speech retries before ending call. Default: 3 */
  maxNoSpeechRetries?: number;

  /** Rate limiting configuration */
  rateLimit?: {
    /** Max requests per window per phone number. Default: 30 */
    maxRequests?: number;
    /** Window size in milliseconds. Default: 60000 (1 minute) */
    windowMs?: number;
  };

  /** Maximum input length for speech/SMS messages in characters. Default: 1000 */
  maxInputLength?: number;

  /**
   * Chat function override. By default, talker queries chatter's RAG
   * pipeline directly. A throw is logged and answered with a generic
   * apology reply - there is no fall-through to `chatbot`/chatter, since
   * configuring `chatFn` means the host owns this path entirely.
   */
  chatFn?: (phoneNumber: string, message: string) => Promise<string>;

  /**
   * Persona resolver for the plugin-mode chat pipeline.
   *
   * Called per interaction with the caller's phone number and message; returns a
   * persona system-prompt layer that REPLACES chatter's default public persona
   * layer (base rules and RAG context are kept). Return null/undefined to use
   * the default persona. Errors are logged and fall back to the default.
   *
   * Unlike `chatFn`, this keeps talker's full pipeline - retrieval, processing,
   * flows - and only swaps the voice.
   */
  personaFn?: (
    phoneNumber: string,
    message: string,
  ) => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Dynamic greeting resolver, called with the caller's number and channel
   * before any phrase lookup - lets a host greet per-caller (by name, persona,
   * time of day) without an LLM round-trip. Return null/undefined to fall back
   * to the phrase-file greeting; errors also fall back.
   */
  greetingFn?: (
    phoneNumber: string,
    channel: "call" | "sms" | "whatsapp",
  ) => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Callback invoked when a message delivery status update is received.
   * Called for both SMS and WhatsApp status callbacks.
   * Fire-and-forget: a throwing or slow handler is logged and never delays
   * the webhook's 200 response to Twilio - but that also means completion
   * isn't guaranteed, since the handler may still be starting or running
   * after the response is sent. On a runtime that freezes execution once a
   * response returns, async work here can be cut off mid-flight.
   */
  onMessageStatus?: (event: MessageStatusEvent) => void | Promise<void>;

  /**
   * Generic message tap, fired for every inbound message and every outbound
   * reply on all channels (call, sms, whatsapp) - the observability seam a
   * downstream consumer can use for a live feed without parsing TwiML.
   * Fire-and-forget: a throwing or slow handler is logged and never affects
   * message delivery. Complements `onMessageStatus`, which reports delivery
   * status after Twilio processes a send.
   */
  onMessage?: (event: MessageTapEvent) => void | Promise<void>;
}

/**
 * Dependencies available to talker routes and handlers
 */
export interface TalkerDependencies {
  /** Chatter server dependencies (OpenAI client, VectorStore, PromptLoader, config) */
  chatter: ServerDependencies;
  /** Talker-specific configuration */
  config: TalkerConfig;
  /** Resolved OpenAI API key for the processing pipeline */
  openaiApiKey: string;
  /** Resolved OpenAI model for the processing pipeline */
  openaiModel: string;
}

/**
 * Result from the incoming message pre-processor
 */
export interface IncomingResult {
  /** Whether the caller should be transferred to a human */
  shouldTransfer: boolean;
  /** Whether the caller wants to end the conversation */
  shouldEndCall: boolean;
  /** Detected language code (ISO 639-1) */
  detectedLanguage: string;
  /** Cleaned and processed message */
  processedMessage: string;
}

/**
 * Flow-related types
 */

export interface FlowSchemaProperty {
  type: "string" | "number" | "boolean";
  description?: string;
}

export interface FlowSchema {
  type: "object";
  properties: Record<string, FlowSchemaProperty>;
  required: string[];
}

/**
 * Highest `contractVersion` the loader understands. A flow.json omitting
 * `contractVersion` is treated as version 1 (every flow written before this
 * field existed); a flow.json naming a version above this one fails to load
 * with an actionable error rather than being silently misinterpreted. Kept
 * numerically aligned with chatter's own `CURRENT_FLOW_CONTRACT_VERSION`
 * (src/flows/types.ts there) even though this is talker's own loader fork.
 */
export const CURRENT_FLOW_CONTRACT_VERSION = 1;

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  schema: FlowSchema;
  /** Defaults to 1 when omitted. See {@link CURRENT_FLOW_CONTRACT_VERSION}. */
  contractVersion?: number;
}

export interface FlowState {
  flowName: string;
  params: Record<string, unknown>;
  attempts: number;
  startedAt: number;
}

export interface FlowHandlerResult {
  /**
   * Whether the flow itself completed successfully. When `false`, the SMS
   * and WhatsApp processors discard `say`/`sms`/`whatsapp` entirely and
   * substitute a generic, out-of-persona "processingError" phrase; a voice
   * call instead speaks `say` and transfers to `transferNumber`. A handler
   * that wants its own in-persona message to reach the caller for an
   * expected failure (rate limit, validation, a caught upstream error) must
   * still report `success: true` - `success: false` is reserved for
   * "something went wrong that a generic fallback should cover instead."
   */
  success: boolean;
  result?: unknown;
  /** What to say via voice/call */
  say: string;
  /** Delivered as the SMS reply body when non-empty; falls back to `say` otherwise */
  sms?: string;
  /** Delivered as the WhatsApp reply body when non-empty; falls back to `say` otherwise */
  whatsapp?: string;
}

export interface FlowHandlerContext {
  phoneNumber: string;
  channel: Channel;
}

export type FlowHandler = (
  params: Record<string, unknown>,
  context: FlowHandlerContext,
) => Promise<FlowHandlerResult>;

export type FlowPrefill = (
  phoneNumber: string,
  context: Record<string, unknown>,
) => Record<string, unknown>;

export interface FlowExtractionResult {
  extractedParams: Record<string, unknown>;
  allParamsFilled: boolean;
  nextPrompt?: string;
}

export interface IntentDetection {
  intent: string;
  confidence: number;
  reasoning?: string;
}

export interface LoadedFlow {
  definition: FlowDefinition;
  handler: FlowHandler;
  instructionsPath: string;
  prefill?: FlowPrefill;
}

export interface FlowResult {
  isFlowActive: boolean;
  response: string;
  flowCompleted: boolean;
  /** SMS-specific reply body, delivered by the SMS processor instead of `response` when non-empty */
  smsContent?: string;
  /** WhatsApp-specific reply body, delivered by the WhatsApp processor instead of `response` when non-empty */
  whatsappContent?: string;
  flowSuccess?: boolean;
  /** The user cancelled an active flow; `response` carries phrases.flow.cancelled */
  cancelled?: boolean;
  /** Flow processing failed (registry lookup, parameter extraction, or handler init); `response` carries phrases.flow.error */
  error?: boolean;
}

/**
 * Conversation context stored per phone number
 */
export interface TelephonyContext {
  phoneNumber: string;
  channel: Channel;
  detectedLanguage: string | null;
  messageHistory: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>;
  activeFlow: FlowState | null;
  noSpeechRetries: number;
  lastPrompt: string | null;
  createdAt: number;
  lastActivity: number;
}

/**
 * A phrase entry: a single string, or an array to rotate through (a random
 * variant is picked per use).
 */
export type PhraseValue = string | string[];

/**
 * Phrase file structure for each language
 */
export interface Phrases {
  greeting: PhraseValue;
  didNotCatch: PhraseValue;
  /** Unused by the no-speech ladder, which speaks didNotHearRetry/didNotHearFinal instead. Kept for backward compatibility. */
  didNotHear: PhraseValue;
  didNotHearRetry: PhraseValue;
  didNotHearFinal: PhraseValue;
  transfer: PhraseValue;
  acknowledgment: PhraseValue;
  farewell: {
    morning: PhraseValue;
    afternoon: PhraseValue;
    evening: PhraseValue;
  };
  error: PhraseValue;
  timeout: PhraseValue;
  lostQuestion: PhraseValue;
  flow: {
    cancelled: PhraseValue;
    error: PhraseValue;
    /** Asked when the engine fills some parameters but returns no prompt of its own. */
    needMoreDetails: PhraseValue;
    /**
     * Words and phrases that end an in-progress flow in this language. A list,
     * not a rotation: every entry is matched, none is spoken. Matching is
     * whole-word, case-insensitive and accent-insensitive, so ASCII entries
     * still match accented speech-to-text output.
     */
    cancellationKeywords: PhraseValue;
  };
  sms: {
    greeting: PhraseValue;
    greetingShort: PhraseValue;
    callForHelp: PhraseValue;
    processingError: PhraseValue;
    genericError: PhraseValue;
  };
  whatsapp: {
    greeting: PhraseValue;
    greetingShort: PhraseValue;
    callForHelp: PhraseValue;
    processingError: PhraseValue;
    genericError: PhraseValue;
  };
  voice: {
    overCapPerNumber: PhraseValue;
    overCapGlobal: PhraseValue;
    limitUnavailable: PhraseValue;
    unintelligible: PhraseValue;
    answerFailed: PhraseValue;
  };
}

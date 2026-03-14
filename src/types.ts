/**
 * Talker Type Definitions
 *
 * Core types for the Talker telephony plugin.
 * These types define the public API and configuration interface.
 */

import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type { Hono } from "hono";
import type OpenAI from "openai";

/**
 * Channel type for telephony interactions
 */
export type Channel = "call" | "sms";

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
  /** Twilio phone number for outbound SMS */
  phoneNumber?: string;
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

  /** Route prefix for telephony endpoints. Default: "" (mounts at /call and /sms) */
  routePrefix?: string;

  /** Conversation context TTL in milliseconds. Default: 1800000 (30 minutes) */
  contextTtlMs?: number;

  /** Context cleanup interval in milliseconds. Default: 300000 (5 minutes) */
  cleanupIntervalMs?: number;

  /** Maximum no-speech retries before ending call. Default: 3 */
  maxNoSpeechRetries?: number;

  /** Chat function override. By default, talker queries chatter's RAG pipeline directly */
  chatFn?: (phoneNumber: string, message: string) => Promise<string>;
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

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  schema: FlowSchema;
}

export interface FlowState {
  flowName: string;
  params: Record<string, unknown>;
  attempts: number;
  startedAt: number;
}

export interface FlowHandlerResult {
  success: boolean;
  result?: unknown;
  /** What to say via voice/call */
  say: string;
  /** Optional: different content for SMS */
  sms?: string;
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
  smsContent?: string;
  flowSuccess?: boolean;
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
 * Phrase file structure for each language
 */
export interface Phrases {
  greeting: string;
  didNotCatch: string;
  didNotHear: string;
  didNotHearRetry: string;
  didNotHearFinal: string;
  transfer: string;
  acknowledgment: string;
  farewell: {
    morning: string;
    afternoon: string;
    evening: string;
  };
  error: string;
  timeout: string;
  lostQuestion: string;
  flow: {
    cancelled: string;
  };
  sms: {
    greeting: string;
    greetingShort: string;
    callForHelp: string;
    processingError: string;
    genericError: string;
  };
}

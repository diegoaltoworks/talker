/**
 * Talker Type Definitions
 *
 * Core types for the Talker telephony plugin.
 * These types define the public API and configuration interface.
 */

import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type OpenAI from "openai";
import type { ContextStore } from "./core/context";
import type { TalkerStore } from "./db/store";

/**
 * Channel type for telephony interactions
 */
export type Channel = "call" | "sms" | "whatsapp";

/**
 * Channel type for the two messaging (non-voice) surfaces. A subset of
 * {@link Channel} - single-sourced here so route handlers, phrase lookup and
 * db records that only ever see SMS/WhatsApp don't each respell the union.
 */
export type MessagingChannel = "sms" | "whatsapp";

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
  channel: MessagingChannel;
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
   * Default: 5000 (5 seconds). One webhook makes up to two of these calls
   * sequentially, so the default is kept well under half the ~15s budget -
   * see `DEFAULT_OPENAI_REQUEST_TIMEOUT_MS`, which this number is pinned to
   * by `src/core/processing/openai.test.ts`.
   */
  requestTimeoutMs?: number;
  /**
   * Sampling temperature for the pre/post-processing pipeline's OpenAI
   * calls (language detection, transfer/end-call intent, message cleanup).
   * Lower values keep those structured, single-answer tasks deterministic.
   * Default: 0.3
   */
  temperature?: number;
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

  /**
   * Database config for session persistence: opens talker's own Turso/libSQL
   * connection. Takes priority over the plugin-mode default (below) - set
   * this only when talker should persist to a different database than
   * chatter's.
   */
  database?: {
    /** Turso/libSQL database URL */
    url: string;
    /** Turso auth token */
    authToken: string;
  };

  /**
   * Bring-your-own persistence for sessions, messages and delivery status.
   * When set, this is used as-is and no migrations run - the host owns its
   * own schema. Default resolution order (see `TalkerDependencies.store` and
   * `src/db/resolve-store.ts`): `database` above if set, else (plugin mode
   * only) chatter's own already-connected database - avoiding a second
   * connection to the same database - else a no-op store.
   */
  store?: TalkerStore;

  /** OpenAI API key for the pre/post-processing pipeline. Falls back to chatter's OpenAI client */
  openaiApiKey?: string;

  /** Route prefix for telephony endpoints. Default: "" (mounts at /call, /sms, and /whatsapp) */
  routePrefix?: string;

  /** Conversation context TTL in milliseconds. Default: 1800000 (30 minutes) */
  contextTtlMs?: number;

  /** Context cleanup interval in milliseconds. Default: 300000 (5 minutes) */
  cleanupIntervalMs?: number;

  /**
   * Storage for per-phone-number conversation context. Default: an
   * in-memory `Map` (`createInMemoryContextStore()`). The interface is
   * synchronous, so this swaps for another in-process implementation - an
   * LRU with its own eviction policy, a store instrumented for
   * observability, a synchronous embedded-DB-backed store for durability
   * across restarts - not a networked or remote one. See
   * docs/ARCHITECTURE.md's "Single-process state caveat" and the
   * `ContextStore` doc comment (`src/core/context.ts`).
   */
  contextStore?: ContextStore;

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
    channel: Channel,
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
 *
 * `chatter` is present in plugin mode (`createTelephonyRoutes`) and absent
 * in standalone mode - standalone has no real `ServerDependencies` to hand
 * over (no VectorStore, no PromptLoader), so it leaves the field unset
 * rather than faking one with a cast. Code that only needs an OpenAI client
 * (flow intent detection, parameter extraction) should read `openaiClient`
 * instead, which both modes populate; code specific to chatter's RAG
 * pipeline (`src/core/chat.ts`'s branch 3) reads `chatter` directly and must
 * handle it being undefined.
 */
export interface TalkerDependencies {
  /** Chatter server dependencies (OpenAI client, VectorStore, PromptLoader, config). Plugin mode only. */
  chatter?: ServerDependencies;
  /**
   * OpenAI client for flow intent detection and parameter extraction.
   * Plugin mode reuses `chatter.client`; standalone mode creates its own
   * when `flowsDir` is configured. Undefined when flows are not in use.
   */
  openaiClient?: OpenAI;
  /** Talker-specific configuration */
  config: TalkerConfig;
  /** Resolved OpenAI API key for the processing pipeline */
  openaiApiKey: string;
  /** Resolved OpenAI model for the processing pipeline */
  openaiModel: string;
  /**
   * Session/message/status persistence. `createTelephonyRoutes`/
   * `createStandaloneServer` always populate this before mounting (see
   * `src/db/resolve-store.ts`), so it is only left `undefined` when a caller
   * builds `TalkerDependencies` by hand (mainly tests) - `db/persist.ts` and
   * `db/sessions.ts`'s deprecated no-deps exports fall back to the legacy
   * singleton client in that case. Route handlers read `deps.store` directly.
   */
  store?: TalkerStore;
}

/**
 * Conversation context stored per phone number.
 * Co-located with the store that owns it; re-exported here for compatibility.
 * @deprecated Import from `./core/context` instead.
 */
export type { TelephonyContext } from "./core/context";
/**
 * Phrase file structure for each language, co-located with the loader that
 * validates it; re-exported here for compatibility.
 * @deprecated Import from `./core/phrases` instead.
 */
export type { Phrases, PhraseValue } from "./core/phrases";
/**
 * Result from the incoming message pre-processor.
 * Co-located with its one producer; re-exported here for compatibility.
 * @deprecated Import from `./core/processing/incoming` instead.
 */
export type { IncomingResult } from "./core/processing/incoming";
/**
 * Flow-related types, co-located with the flow presentation layer;
 * re-exported here for compatibility.
 * @deprecated Import from `./flows/types` instead.
 */
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

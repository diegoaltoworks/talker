# Talker

<div align="center">

**Telephony plugin for Chatter — voice call and SMS support via Twilio**

[![NPM Version](https://img.shields.io/npm/v/@diegoaltoworks/talker)](https://www.npmjs.com/package/@diegoaltoworks/talker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Features](#features) • [Quick Start](#quick-start) • [Examples](#examples) • [Configuration](#configuration) • [Customization](#customization)

</div>

## Features

- **Voice Calls**: Twilio webhook handlers with speech-to-text, text-to-speech, and continuous conversation loops
- **SMS**: Inbound/outbound messaging with channel-appropriate formatting
- **Pre/Post-Processing**: OpenAI-powered language detection, STT artifact cleanup, phone-friendly response formatting, and automatic translation
- **Voice Notes**: Channel-agnostic speech-to-text, text-to-speech, Ogg/Opus inspection, and daily spend guards as standalone exports
- **Structured Flows**: LLM intent detection + parameter extraction for guided multi-step conversations
- **Human Handoff**: Automatic transfer to a real person on request or frustration signals
- **Multi-Language**: English, French, German, Dutch, Spanish, Portuguese out of the box
- **Two Modes**: Plugin for [Chatter](https://github.com/diegoaltoworks/chatter), or standalone with any chatbot backend
- **TypeScript**: Fully typed for excellent developer experience

## Quick Start

```bash
# With chatter (plugin mode)
bun add @diegoaltoworks/talker

# Standalone (no chatter required)
bun add @diegoaltoworks/talker hono
```

**As a Chatter plugin** — one server, one port, web chat + phone + SMS:

```typescript
import { createServer } from '@diegoaltoworks/chatter';
import { createTelephonyRoutes } from '@diegoaltoworks/talker';

const app = await createServer({
  bot: { name: 'MyBot', personName: 'Your Name' },
  openai: { apiKey: process.env.OPENAI_API_KEY },
  database: { url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN },
  customRoutes: async (app, deps) => {
    await createTelephonyRoutes(app, deps, {
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      },
      transferNumber: '+441234567890',
    });
  },
});

Bun.serve({ port: 8181, fetch: app.fetch });
```

**As a standalone server** — point at a remote chatbot API:

```typescript
import { createStandaloneServer } from '@diegoaltoworks/talker';

const app = await createStandaloneServer({
  openaiApiKey: process.env.OPENAI_CHATGPT_KEY || '',
  // Required: webhooks refuse to mount without it (see Webhook signature validation)
  twilio: { authToken: process.env.TWILIO_AUTH_TOKEN },
  chatbot: {
    url: process.env.CHATBOT_URL || 'http://localhost:8181/api/public/chat',
    apiKey: process.env.CHATBOT_API_KEY,
  },
  transferNumber: '+441234567890',
});

Bun.serve({ port: 3000, fetch: app.fetch });
```

**Requirements:** OpenAI API key, Bun runtime. Twilio account for production use.

### Optional peer dependencies

`hono` is the only hard requirement. The rest are optional peers: talker imports
them for types only and loads them on first use, so importing the package never
fails because one is missing, and installing one you don't need is never
necessary. A feature whose peer is absent says so — naming the package and the
fix — at the point of use rather than at import.

| Package | Needed for | Without it |
| --- | --- | --- |
| `@diegoaltoworks/chatter` | Plugin mode; flow intent detection and parameter extraction | LLM intent detection matches nothing; the critical-keyword handoff and any parameterless flow still run |
| `openai` | Standalone mode with `flowsDir`; the voice STT/TTS factories when you pass a real client | `createStandaloneServer` throws at setup if `flowsDir` is set; injected-client voice factories are unaffected |
| `@libsql/client` | Session persistence (`database` config) | `initDbClient` rejects; omit `database` to run without persistence |

### Entry points

| Import | What it gives you |
| --- | --- |
| `@diegoaltoworks/talker` | Everything — route factories, plugin and standalone entry points, voice capabilities, flows, TwiML helpers, and the Twilio REST helpers |
| `@diegoaltoworks/talker/twilio` | Only the outbound Twilio REST helpers — `sendSMS`, `sendWhatsApp`, `stripWhatsAppPrefix` and the `SendMessageOptions` type — for senders that never mount a webhook |

Both are dual ESM/CJS and ship their own type declarations. The subpath is a
narrower slice of the root export, not a different implementation; an app that
uses both ends up with two copies of the same stateless helpers, which is
wasteful rather than wrong.

## Examples

**[Complete Examples](./examples/)** — Ready-to-run examples for all use cases:

- **[Chatter Plugin](./examples/chatter-plugin.ts)** — Single server with web chat + phone + SMS
- **[Standalone Server](./examples/standalone.ts)** — Phone/SMS with your own chatbot backend
- **[Custom Flows](./examples/custom-flows.ts)** — Structured conversations with parameter collection

## Configuration

```typescript
interface TalkerConfig {
  // Twilio credentials. `authToken` is required to mount the webhooks:
  // it is what validates the X-Twilio-Signature header.
  twilio?: {
    accountSid?: string;
    authToken?: string;
    phoneNumber?: string;
    // Twilio Messaging Service SID. When set, outbound messages use
    // MessagingServiceSid instead of From (sender pool, sticky sender, compliance).
    messagingServiceSid?: string;
  };

  // Public URL webhooks are received on (e.g. "https://bot.example.com").
  // Set this behind a reverse proxy so signatures are checked against the
  // URL Twilio actually called. Query strings are preserved.
  publicUrl?: string;

  // Mount the webhooks without signature validation. Development only.
  // Default: false — see "Webhook signature validation" below.
  allowUnsignedWebhooks?: boolean;

  // Phone number for human handoff
  transferNumber?: string;

  // Voice config per language (defaults: Polly voices for 6 languages)
  voices?: Record<string, { voice: string; language: string }>;

  // Structured flow definitions directory
  flowsDir?: string;

  // Custom language phrase files directory
  languageDir?: string;

  // Processing pipeline (pre/post-processing with OpenAI)
  processing?: {
    model?: string;              // Default: "gpt-4o-mini"
    incomingPromptPath?: string; // Custom incoming message prompt
    outgoingPromptPath?: string; // Custom outgoing response prompt
  };

  // Feature flags
  features?: {
    thinkingAcknowledgmentEnabled?: boolean; // "One moment please" pattern
  };

  // Remote chatbot API (standalone mode — not needed in plugin mode)
  chatbot?: {
    url: string;               // e.g., "https://bot.example.com/api/public/chat"
    apiKey?: string;           // Sent as x-api-key header
    systemMessage?: string;    // Override default system prompt
  };

  // Database config for session persistence. In plugin mode, falls back to
  // chatter's database config.
  database?: {
    url: string;       // Turso/libSQL database URL
    authToken: string; // Turso auth token
  };

  // Override OpenAI key (falls back to chatter's key in plugin mode)
  openaiApiKey?: string;

  // Route prefix for all endpoints. Default: ""
  routePrefix?: string;

  // Conversation TTL. Default: 30 minutes
  contextTtlMs?: number;

  // Context cleanup interval. Default: 5 minutes
  cleanupIntervalMs?: number;

  // How long an unresolved /call/answer acknowledgment is kept before the
  // cleanup sweep discards it. Checked once per cleanupIntervalMs tick, not
  // a hard deadline. Keep it above callAnswerBudgetMs. Default: 1 minute
  pendingQueryTtlMs?: number;

  // Budget for background call processing before /call/answer gives up and
  // speaks a timeout phrase. Stay well under Twilio's ~15s webhook timeout
  // so the phrase is actually deliverable. Default: 8 seconds
  callAnswerBudgetMs?: number;

  // Max silence retries before ending call. Default: 3
  maxNoSpeechRetries?: number;

  // Rate limiting, per phone number
  rateLimit?: {
    maxRequests?: number; // Default: 30
    windowMs?: number;    // Default: 1 minute
  };

  // Max characters accepted from speech/SMS input before it's clamped. Default: 1000
  maxInputLength?: number;

  // Custom chat function (overrides chatbot config and chatter RAG). A throw is
  // logged and answered with a generic apology - no fall-through to chatbot/chatter.
  chatFn?: (phoneNumber: string, message: string) => Promise<string>;

  // Per-interaction persona resolver for the plugin-mode chat pipeline. Replaces
  // chatter's default persona layer (base rules and RAG context are kept); return
  // null/undefined to use the default. Errors are logged and fall back to the default.
  personaFn?: (
    phoneNumber: string,
    message: string,
  ) => Promise<string | null | undefined> | string | null | undefined;

  // Dynamic per-caller greeting, called before any phrase lookup. Return
  // null/undefined to fall back to the phrase-file greeting; errors also fall back.
  greetingFn?: (
    phoneNumber: string,
    channel: "call" | "sms" | "whatsapp",
  ) => Promise<string | null | undefined> | string | null | undefined;

  // Callback invoked when a Twilio delivery status update is received for
  // an SMS/WhatsApp message you sent (queued, sent, delivered, failed...).
  // Fire-and-forget: a throwing or slow handler is logged and never delays
  // the webhook's 200 response to Twilio.
  onMessageStatus?: (event: MessageStatusEvent) => void | Promise<void>;

  // Fired for every inbound message and every outbound reply on all
  // channels (call, sms, whatsapp) - a live feed without parsing TwiML.
  // `body` is the plain text delivered, never XML-escaped.
  // Fire-and-forget: a throwing or slow handler is logged and never affects
  // message delivery. `from`/`to` flip with direction (outbound `from` is
  // your Twilio number); `to` is "" when Twilio omits it. Fires when the
  // reply text is generated, not when Twilio confirms delivery - for
  // delivery truth use `onMessageStatus`. Handlers run independently and
  // aren't ordered relative to each other; sort by `timestamp` if needed.
  onMessage?: (event: {
    direction: "inbound" | "outbound";
    channel: "call" | "sms" | "whatsapp";
    from: string;
    to: string;
    body: string;
    timestamp: number;
  }) => void | Promise<void>;
}
```

### Chat resolution order

In plugin mode, a message is answered by the first of:

1. `chatFn`, if set — full override, bypasses chatter entirely.
2. `chatbot.url`, if set — remote HTTP API (standalone mode).
3. Chatter's RAG pipeline, via chatter's `prepareChat`. The assembled system
   prompt layers base rules, then a persona (chatter's default, or
   `personaFn`'s per-interaction override), then a hint naming the channel
   (call/sms/whatsapp), then retrieved context. Retrieval scope honours
   chatter's own `bucketsFor` hook (set on the chatter server config, not
   here) for per-sender role-gated knowledge; an unidentified caller is
   always clamped to the channel's default buckets. The assembled prompt is
   answered via chatter's `answerOnce`, so a chatter-level `answerFn` (an
   agent framework, a graph runtime — set on the chatter server config, not
   here) answers telephony turns exactly like every other chatter surface;
   with no `answerFn` configured this is the same built-in OpenAI completion
   as always. The caller's phone number is passed as `sender` (omitted for
   the "unknown" sentinel Twilio uses when it doesn't supply one).

### Hook error semantics

These hooks sit on the request path. Each fails differently by design — a
config-time override (`chatFn`) has nowhere else to fall back to, while an
enrichment hook (`personaFn`, `greetingFn`) degrades to a sane default, and an
observability tap (`onMessage`, `onMessageStatus`) must never affect delivery
at all:

| Hook | Purpose | On throw/reject |
|---|---|---|
| `chatFn` | Full chat override | Logged; caller gets a generic apology reply (no fall-through to `chatbot`/chatter — the host asked to own this path) |
| `personaFn` | Per-interaction persona swap | Logged; chatter's default persona layer is used instead |
| `greetingFn` | Per-caller dynamic greeting | Logged; the phrase-file greeting is used instead |
| `onMessage` | Inbound/outbound message tap | Logged; fire-and-forget, never delays or affects the reply |
| `onMessageStatus` | Twilio delivery status tap | Logged; fire-and-forget, never delays the webhook's 200 |

`onMessage` and `onMessageStatus` are fire-and-forget: the handler is scheduled
after the response is already decided, so it may still be running (or not yet
started) when the webhook's 200 is sent. On a runtime that freezes execution
once a response is returned (serverless platforms in particular), a handler
doing further async work can be cut off mid-flight. Neither hook is a
guarantee of completion — only of non-blocking, logged-on-failure delivery.

## Twilio Setup

1. Get a Twilio phone number
2. Set webhook URLs in the Twilio console:

| Webhook | URL | Method |
|---|---|---|
| Voice | `https://your-server.com/call` | HTTP POST |
| Voice status callback | `https://your-server.com/call/status` | HTTP POST |
| SMS | `https://your-server.com/sms` | HTTP POST |
| SMS fallback | `https://your-server.com/sms/fallback` | HTTP POST |
| SMS status callback | `https://your-server.com/sms/status` | HTTP POST |
| WhatsApp | `https://your-server.com/whatsapp` | HTTP POST |
| WhatsApp fallback | `https://your-server.com/whatsapp/fallback` | HTTP POST |
| WhatsApp status callback | `https://your-server.com/whatsapp/status` | HTTP POST |

Fallback URLs are only consulted by Twilio when the primary webhook errors or
times out; status callback URLs receive delivery status updates after a
message is sent (see `onMessageStatus` below). Both are optional in the
Twilio console but recommended.

### Webhook signature validation

Every telephony webhook is protected by Twilio's `X-Twilio-Signature` header,
validated with `twilio.authToken`. Validation fails closed:

- **No `twilio.authToken`** — mounting throws. There is no way to tell a genuine
  Twilio request from a forged one, so the routes are not exposed at all.
- **`allowUnsignedWebhooks: true`** — mounting proceeds with an unmissable
  warning and requests are accepted unsigned. This is for local development and
  tests; anyone who can reach the endpoints can impersonate Twilio.
- **Missing or wrong signature** — the request is rejected with `403`.

Signatures are computed over the exact URL Twilio called, including any query
string. Behind a reverse proxy (where the request URL talker sees is not the
public one) set `publicUrl` so the two agree.

## Customization

### Custom Flows

Flows are structured conversations with automatic parameter collection. Intent detection and parameter
extraction are powered by chatter's flow engine (`@diegoaltoworks/chatter/flows`); talker keeps directory
loading and the presentation layer (per-channel rendering, phrase-sourced cancel/error). Both engine
functions are loaded on first use, so `@diegoaltoworks/chatter` stays an optional peer - without it,
intent detection logs an actionable error and no flow matches, while the critical-keyword handoff (which
needs no LLM call) keeps working. In standalone mode, configuring `flowsDir` also requires `openai` to be
installed - talker constructs an OpenAI client internally from `openaiApiKey`. In plugin mode this happens
automatically via chatter's own client.

Each flow is a directory with three files:

```
config/flows/addNumbers/
  flow.json         — Definition (id, keywords, parameter schema)
  handler.ts        — Exports an execute() function
  instructions.md   — System prompt for parameter extraction
```

**flow.json:**
```json
{
  "id": "addNumbers",
  "name": "Add Two Numbers",
  "description": "Adds two numbers together",
  "triggerKeywords": ["add", "sum", "plus"],
  "schema": {
    "type": "object",
    "properties": {
      "firstNumber": { "type": "number", "description": "First number" },
      "secondNumber": { "type": "number", "description": "Second number" }
    },
    "required": ["firstNumber", "secondNumber"]
  }
}
```

**handler.ts:**
```typescript
import type { FlowHandlerResult, FlowHandlerContext } from '@diegoaltoworks/talker';

export async function execute(
  params: Record<string, unknown>,
  context: FlowHandlerContext,
): Promise<FlowHandlerResult> {
  const sum = Number(params.firstNumber) + Number(params.secondNumber);
  return {
    success: true,
    result: sum,
    say: `${params.firstNumber} plus ${params.secondNumber} equals ${sum}. Need anything else?`,
    sms: `${params.firstNumber} + ${params.secondNumber} = ${sum}`,
    whatsapp: `${params.firstNumber} + ${params.secondNumber} = ${sum}. Anything else?`,
  };
}
```

`say` is used for voice calls and as the fallback reply on every channel; `sms`/`whatsapp` override it for
their respective channel when a flow wants channel-specific phrasing (e.g. a link that only makes sense in
a text message). Set `success: false` only when the flow itself failed - the SMS/WhatsApp processors then
discard `say`/`sms`/`whatsapp` and substitute a generic error phrase, and a voice call transfers to
`transferNumber`. A flow that wants its own in-persona message for an expected failure (a rate limit, a
validation error) should still return `success: true`.

If the user cancels an in-progress flow (a cancellation keyword like "cancel" or "nevermind"), every
channel delivers `phrases.flow.cancelled`. If flow processing itself fails - parameter extraction throws,
the flow can't be found, or a freshly-triggered flow fails to initialize - every channel delivers
`phrases.flow.error` instead of silently falling through to a full chatbot turn.

See [examples/custom-flows.ts](./examples/custom-flows.ts) for a complete walkthrough.

### Custom Language Files

Override built-in phrases by providing a `languageDir`. Place JSON files named by language code (`en.json`, `fr.json`, etc.):

```typescript
createTelephonyRoutes(app, deps, {
  languageDir: './config/language',
});
```

See [language/en.json](./language/en.json) for the expected structure. Files
may be partial - any missing key falls back to this language's own `sms`
copy where applicable (for `whatsapp`), then to the built-in English phrase,
so a file only needs to override what it wants to change.

### Custom Prompts

Override the pre/post-processing system prompts:

```typescript
createTelephonyRoutes(app, deps, {
  processing: {
    incomingPromptPath: './config/prompts/telephony-incoming.md',
    outgoingPromptPath: './config/prompts/telephony-outgoing.md',
  },
});
```

See [prompts/incoming.md](./prompts/incoming.md) and [prompts/outgoing.md](./prompts/outgoing.md) for the default prompts. `getIncomingPrompt(deps)` and `getOutgoingPrompt(deps)` return the prompt actually in force, custom path or packaged default.

### Custom Voices

Override the default Polly TTS voices per language:

```typescript
createTelephonyRoutes(app, deps, {
  voices: {
    en: { voice: 'Polly.Amy', language: 'en-US' },
    fr: { voice: 'Polly.Lea', language: 'fr-FR' },
  },
});
```

### Voice Capabilities

Speech-to-text, text-to-speech, container inspection and daily spend guards ship
as plain root exports rather than route options — they are channel-agnostic
functions, so a host wires them into whichever transport it runs (Twilio
webhooks, a socket-based worker, its own adapter) by calling the factories
directly. Nothing here reads the environment; the OpenAI client is injected, and
`openai` is imported for types only, so it stays an optional peer dependency.

Note the distinction from `getVoiceConfig` above: that maps languages to Polly
voice identifiers for phone-call TwiML. These produce and consume Ogg/Opus audio
bytes for voice-note style delivery.

```typescript
import {
  createSynthesizer,
  createTranscriber,
  createVoiceLimiter,
  parseOggOpus,
  resolveVoiceLimitsConfig,
} from '@diegoaltoworks/talker';
import OpenAI from 'openai';

const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const transcribe = createTranscriber({ client, enabled: () => true });
const synthesize = createSynthesizer({
  client,
  enabled: () => true,
  baseInstructions: 'Speak clearly and unhurriedly.',
  voiceFor: (personaId) => myVoiceMap[personaId ?? 'default'],
});

const text = await transcribe(inboundAudioBytes);   // string | null
const note = await synthesize('Your table is booked.'); // { bytes, seconds } | null
```

**Both return `null` rather than throwing** — on every disabled, empty, API-failure
and validation-failure path. Synthesis also refuses output that is not parseable
Ogg/Opus or is not mono, since some mobile clients will not play a stereo voice
note. Callers are expected to fall back to a text reply; the contract exists so
that fallback is always reachable.

`parseOggOpus(bytes)` returns `{ channels, seconds }` or `null` for anything it
cannot measure, and is what the synthesizer uses for that validation. It walks
the container's page structure rather than scanning for the `OggS` capture
pattern, so payload bytes cannot pose as a page header and drive the reported
duration — inbound voice notes are attacker-controlled, and this is a root
export intended to be pointed at them.

Daily spend guards cap voice usage per number and globally. Storage stays with
the host: implement `VoiceLimitsStore` against whatever database you already run.
The type is structural, so no import or subclassing is needed — an object with a
matching `incrementAndGet` satisfies it.

```typescript
const limiter = createVoiceLimiter(
  resolveVoiceLimitsConfig(process.env),  // VOICE_LIMIT_PER_NUMBER, VOICE_LIMIT_GLOBAL
  { store: myCounterStore },
);

const check = await limiter.checkAndReserve(fromNumber);
if (!check.allowed) { /* check.reason: 'per-number' | 'global' */ }
```

`checkAndReserve` must be called exactly once per voice round-trip, **before**
transcription starts, so one unit covers transcribe + reply. The increment is
permanent and unconditional — there is no release path, so a retry burns a
second unit. `incrementAndGet` must increment and read back atomically; a
read-then-write races across instances.

`runVoiceReply(deps)` chains reserve → download → transcribe → answer →
synthesize → voice-or-text into the full round-trip, with the hard invariant
that every branch attempts a delivered message: a limit hit, a transcription
failure or a synthesis failure all fall back to a text reply rather than
silence. It is channel-agnostic — no Twilio/webhook types in its signature —
so a host wires the pieces above (plus its own `answer` and send functions)
into it directly. Fallback copy comes from `getVoicePhrase`, so it lives in
`language/*.json` alongside the other phrase namespaces rather than being
hardcoded; call it once per branch (not once up front) so rotation still
applies.

```typescript
import { getVoicePhrase, runVoiceReply } from '@diegoaltoworks/talker';

const outcome = await runVoiceReply({
  reserve: () => limiter.checkAndReserve(fromNumber),
  download: () => fetchInboundAudio(),
  transcribe,
  answer: (text) => myBot.reply(fromNumber, text),
  synthesize: (text) => synthesize(text, { personaId: myPersonaFor(fromNumber) }),
  sendVoice: (note) => sendVoiceNote(fromNumber, note),
  sendText: (text) => sendSMS({ to: fromNumber, body: text }),
  phrases: {
    overCapPerNumber: getVoicePhrase(lang, 'overCapPerNumber'),
    overCapGlobal: getVoicePhrase(lang, 'overCapGlobal'),
    limitUnavailable: getVoicePhrase(lang, 'limitUnavailable'),
    unintelligible: getVoicePhrase(lang, 'unintelligible'),
    answerFailed: getVoicePhrase(lang, 'answerFailed'),
  },
});
// outcome: 'voice' | 'text' | 'over-cap' | 'limit-error' | 'no-audio' | 'transcribe-failed' | 'answer-failed'
```

`sendText` is the one call in the ladder that is never wrapped — a failure to
deliver even the guaranteed fallback propagates to the caller instead of
resolving to a silent "undeliverable" outcome.

## Architecture

```
Phone Call / SMS
      |
      v
  Twilio (ASR / TTS / SMS gateway)
      |
      v  POST /call or /sms
  Talker (Hono routes)
      |-- processIncoming  (OpenAI: language detect, transfer intent, STT cleanup)
      |-- Flow lifecycle   (chatter: intent detect + parameter extraction; talker: loading + presentation)
      |-- chatFn / Chatter RAG pipeline
      |-- processOutgoing  (OpenAI: channel formatting, translation)
      |
      v  TwiML response
  Twilio (speaks / sends to caller)
```

**Call lifecycle:** Twilio posts to `/call` on ring, `/call/respond` on speech, `/call/no-speech` on silence, `/call/answer` after async acknowledgment, and `/call/status` on hangup.

## Project Structure

| Directory | What lives there |
|---|---|
| `src/core/processing/` | OpenAI-powered incoming pre-processor and outgoing post-processor |
| `src/core/chatbot/` | HTTP client for remote chatbot APIs (standalone mode) |
| `src/core/` | Context store, TwiML generation, voice config, phrases, logger |
| `src/voice/` | Channel-agnostic voice capabilities — STT, TTS, Ogg/Opus parsing, daily spend guards |
| `src/flows/` | Flow lifecycle and presentation — registry, session state, per-channel rendering (intent detection and parameter extraction live in `@diegoaltoworks/chatter/flows`) |
| `src/routes/call/` | Individual Hono handlers for each Twilio voice webhook |
| `src/routes/messaging/` | Hono handlers for SMS and WhatsApp webhooks, parameterized by channel |
| `src/adapters/` | Twilio REST API client (outbound SMS) |
| `examples/` | Ready-to-run examples for plugin, standalone, and custom flows |
| `language/` | Built-in phrase files (en, fr, de, nl, es, pt) |
| `prompts/` | Default system prompts for the processing pipeline |

## Development

```bash
bun install
bun test                # Run all tests
bun run test:unit       # Unit tests only
bun run test:integration # Integration tests (some require OPENAI_API_KEY)
bun run typecheck       # Type checking
bun run lint            # Biome linting
bun run check           # All checks (typecheck + lint + test)
bun run build           # Build for npm (dual ESM/CJS)
```

## License

MIT

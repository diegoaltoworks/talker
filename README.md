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
  chatbot: {
    url: process.env.CHATBOT_URL || 'http://localhost:8181/api/public/chat',
    apiKey: process.env.CHATBOT_API_KEY,
  },
  transferNumber: '+441234567890',
});

Bun.serve({ port: 3000, fetch: app.fetch });
```

**Requirements:** OpenAI API key, Bun runtime. Twilio account for production use.

## Examples

**[Complete Examples](./examples/)** — Ready-to-run examples for all use cases:

- **[Chatter Plugin](./examples/chatter-plugin.ts)** — Single server with web chat + phone + SMS
- **[Standalone Server](./examples/standalone.ts)** — Phone/SMS with your own chatbot backend
- **[Custom Flows](./examples/custom-flows.ts)** — Structured conversations with parameter collection

## Configuration

```typescript
interface TalkerConfig {
  // Remote chatbot API (standalone mode — not needed in plugin mode)
  chatbot?: {
    url: string;               // e.g., "https://bot.example.com/api/public/chat"
    apiKey?: string;           // Sent as x-api-key header
    systemMessage?: string;    // Override default system prompt
  };

  // Twilio credentials (optional — only needed for outbound SMS)
  twilio?: {
    accountSid?: string;
    authToken?: string;
    phoneNumber?: string;
  };

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

  // Override OpenAI key (falls back to chatter's key in plugin mode)
  openaiApiKey?: string;

  // Route prefix for all endpoints. Default: ""
  routePrefix?: string;

  // Conversation TTL. Default: 30 minutes
  contextTtlMs?: number;

  // Max silence retries before ending call. Default: 3
  maxNoSpeechRetries?: number;

  // Custom chat function (overrides chatbot config and chatter RAG)
  chatFn?: (phoneNumber: string, message: string) => Promise<string>;

  // Callback invoked when a Twilio delivery status update is received for
  // an SMS/WhatsApp message you sent (queued, sent, delivered, failed...).
  onMessageStatus?: (event: MessageStatusEvent) => void | Promise<void>;

  // Fired for every inbound message and every outbound reply on all
  // channels (call, sms, whatsapp) - a live feed without parsing TwiML.
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
   always clamped to the channel's default buckets.

## Twilio Setup

1. Get a Twilio phone number
2. Set webhook URLs in the Twilio console:

| Webhook | URL | Method |
|---|---|---|
| Voice | `https://your-server.com/call` | HTTP POST |
| SMS | `https://your-server.com/sms` | HTTP POST |
| Status Callback | `https://your-server.com/call/status` | HTTP POST |

## Customization

### Custom Flows

Flows are structured conversations with automatic parameter collection. Intent detection and parameter
extraction are powered by chatter's flow engine (`@diegoaltoworks/chatter/flows`); talker keeps directory
loading and the presentation layer (per-channel rendering, phrase-sourced cancel/error). In standalone
mode, configuring `flowsDir` requires `openai` to be installed (it's an optional peer otherwise) - talker
constructs an OpenAI client internally from `openaiApiKey`. In plugin mode this happens automatically via
chatter's own client.

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

See [language/en.json](./language/en.json) for the expected structure.

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

See [prompts/incoming.md](./prompts/incoming.md) and [prompts/outgoing.md](./prompts/outgoing.md) for the default prompts.

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
| `src/routes/sms/` | Hono handlers for SMS webhooks |
| `src/adapters/` | Twilio REST API client (outbound SMS) |
| `examples/` | Ready-to-run examples for plugin, standalone, and custom flows |
| `language/` | Built-in phrase files (en, fr, de, nl, es, pt) |
| `prompts/` | Default system prompts for the processing pipeline |

## Development

```bash
bun install
bun test                # Run all tests (66 tests)
bun run test:unit       # Unit tests only
bun run test:integration # Integration tests (some require OPENAI_API_KEY)
bun run typecheck       # Type checking
bun run lint            # Biome linting
bun run check           # All checks (typecheck + lint + test)
bun run build           # Build for npm (dual ESM/CJS)
```

## License

MIT

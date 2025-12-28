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
}
```

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

Flows are structured conversations with automatic parameter collection. Each flow is a directory with three files:

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
  };
}
```

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
      |-- Flow Engine      (LLM intent detect + parameter extraction)
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
| `src/flows/` | Flow engine — registry, intent detection, parameter extraction, lifecycle |
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

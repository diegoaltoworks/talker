# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Several `src/core/context.ts` log calls interpolated the caller's phone
  number straight into the log message string (e.g. `` `context created for
  ${phoneNumber}` ``), which bypassed `logger`'s field-based redaction — that
  only redacts values under keys named `phoneNumber`/`phone`, not text baked
  into the message itself. Phone numbers now go through as a data field on
  every call, so they get redacted like everywhere else.
- The flow loader's schema check (`src/flows/loader.ts`) verified that
  `flow.json`'s `schema` object was non-empty, not that it had a `properties`
  key — a schema missing `properties` entirely passed validation here and
  then threw a `TypeError` deep inside parameter extraction instead of a
  clear load-time error. The check now validates `schema.properties`
  directly, which is also the exact shape a zero-parameter flow needs to keep
  working (this loader's reason for not delegating to chatter's loader).

### Changed

- The `sanitizedPhone`/`sanitized` locals in `src/db/persist.ts` and
  `src/db/sessions.ts` are renamed to `normalizedPhone`/`normalized` — they
  strip formatting characters for session-id stability, not for privacy; the
  number is stored as plaintext in `talker_sessions.phone_number` either way.
  No behavior change.
- SMS and WhatsApp routing collapsed into a single parameterized
  `src/routes/messaging/` factory (`messagingRoutes(deps, registry, channel)`)
  instead of two near-identical route trees. `smsRoutes` and `whatsappRoutes`
  remain exported as thin, deprecated wrappers around it, so existing
  integrations keep working unchanged. `getSmsPhrase`/`getWhatsAppPhrase` are
  now implemented in terms of a new `getChannelPhrase(channel, ...)` export;
  both keep their previous signatures and fallback behavior.

### Fixed

- The critical-keyword human-handoff check in `FlowRegistry.matchFlow` matched
  keywords as substrings, so a word like "personality" incorrectly triggered
  the handoff on the "person" keyword. Matching is now word-bounded.

### Changed

- **Breaking:** telephony webhooks now fail closed without a Twilio auth token.
  `createTelephonyRoutes` and `createStandaloneServer` throw when
  `twilio.authToken` is absent, and `twilioSignatureMiddleware` rejects every
  request with 403 instead of passing it through. Previously a deployment that
  forgot the token exposed `/call`, `/sms` and `/whatsapp` to anyone who could
  reach them, with no signal that signatures were not being checked. Set
  `twilio.authToken`, or set `allowUnsignedWebhooks: true` to keep the old
  behaviour for development — that path mounts with a loud warning.

### Fixed

- TwiML helpers now escape every value they interpolate. `gatherTwiml`,
  `sayTwiml`, `transferTwiml`, `acknowledgmentTwiml` and `farewellTwiml`
  embedded text verbatim, so an `&`, `<` or `>` in a greeting, phrase, flow
  response or bot reply produced invalid XML — Twilio answered with error
  12100 and dropped the call. The hand-rolled TwiML in the initial-call
  handler escapes its greeting too. Callers must now pass plain text:
  pre-escaped input would be escaped twice and read out as entities.
  `escapeXml` also escapes apostrophes (`&apos;`), completing the five XML
  predefined entities.

- The last prompt stored for the no-speech retry ladder is now the unescaped
  text. The call processor used to escape before handing the prompt to
  `gatherTwiml`, so a retry concatenated escaped and unescaped copies and the
  `onMessage` tap reported bodies containing `&amp;` entities instead of what
  the caller heard.

- Twilio signature validation no longer drops the query string when `publicUrl`
  is configured. Twilio signs the full URL it called, so a webhook configured
  with query parameters failed validation and was rejected as forged.

- The `@diegoaltoworks/chatter` peer range is now `>=0.32.0 <1` instead of
  `^0.32.0`. A caret on a `0.x` version resolves to `>=0.32.0 <0.33.0`, so
  every chatter minor after 0.32 fell outside the range; installing the latest
  of both packages produced a peer conflict for a combination that works. CI
  now runs typecheck and the suite against `chatter@latest` in a dedicated job,
  alongside the existing job that pins the bottom of the range.
- Optional peer dependencies are no longer load-bearing at import. Top-level
  value imports of `@diegoaltoworks/chatter/flows` (flow manager and registry)
  and `@libsql/client` (database client) made
  `import "@diegoaltoworks/talker"` throw for a host that installed only
  `hono`, breaking both the standalone quick start and voice-only usage. Both
  are now loaded at first use, and a missing peer produces an error naming the
  package and the fix instead of a module-resolution failure. Flow intent
  detection degrades to "no flow matched" without the peer; the
  critical-keyword human handoff keeps working, since neither the keyword match
  nor a parameterless flow needs the engine.
- A flow that declares no parameters no longer makes a parameter-extraction
  call. There was nothing to extract from an empty schema, so this only removes
  an LLM round trip — and it is what keeps the keyword-triggered handoff alive
  when the flow engine is unavailable.

### Changed

- **Breaking:** `initDbClient()` is now `async` and must be awaited — an
  unawaited call leaves `getDbClient()` returning `null` on the next line, and
  its rejection unhandled. It rejects with an actionable error when
  `@libsql/client` cannot be loaded; other connection failures keep the
  previous behavior (logged, persistence disabled). Callers change from
  `initDbClient(url, token)` to `await initDbClient(url, token)`.
- `FlowRegistry` takes an optional second constructor argument, the flow-engine
  loader, so the peer-absent path is testable. It defaults to the real loader;
  existing `new FlowRegistry(dir)` calls are unaffected.
- The optional-peer guard test walks the whole `src` tree against every peer
  marked optional in the manifest, statement-based so multi-line
  `import type` declarations are not misread. It previously scanned only
  `src/voice` for `openai`. A packed-tarball smoke test
  (`bun run test:packaged`, run in CI) installs the built artifact into a
  project holding only `hono` and imports it.

- `FlowRegistry` and `processFlow` now source LLM intent detection and
  parameter extraction from chatter's flow engine
  (`@diegoaltoworks/chatter/flows`) instead of talker's own duplicate
  raw-fetch implementations. Directory loading stays talker's own
  (`src/flows/loader.ts`) - chatter's loader requires at least one schema
  property per flow, which would silently drop zero-parameter flows like a
  keyword-triggered human handoff. The on-disk flow contract (`flow.json` +
  `handler.ts` exporting `execute()` + `instructions.md`, optional
  `prefill.ts`) and the handler's `{success, say, sms?, whatsapp?, result?}`
  return shape are unchanged - existing flow directories load and run as
  before.
- **Breaking for flow users:** `FlowRegistry`/`processFlow` now require a
  real OpenAI SDK client at `TalkerDependencies.chatter.client` for intent
  detection and parameter extraction (chatter's engine calls the client
  directly rather than raw `fetch`). Plugin mode gets this automatically
  from chatter. Standalone mode constructs one internally whenever
  `flowsDir` is configured - `openai` remains an optional peer dependency
  otherwise.
- Flow session state stays in talker's in-memory per-caller context, as it
  always has - there is no database table to migrate.

### Added

- Channel-agnostic voice capabilities as root exports: `createSynthesizer`
  (text-to-speech), `createTranscriber` (speech-to-text), `parseOggOpus`
  (Ogg/Opus container inspection), and `createVoiceLimiter` /
  `resolveVoiceLimitsConfig` (per-number and global daily spend guards)
- `VoiceLimitsStore`, a structural interface letting a host back the daily
  counters with its own storage — talker takes on no database dependency

`parseOggOpus` walks the container's page structure rather than scanning for the
capture pattern, so payload bytes cannot pose as a page header; the
unknown-position granule sentinel and implausible durations return `null`. The
synthesizer and transcriber return `null` on every failure path including a
throwing `enabled()` or client factory, so a caller's text fallback is always
reachable.

Additive only; no existing signature changed. The OpenAI client is injected and
`openai` is imported for types only, so it remains an optional peer dependency.

## [0.1.0] - 2026-03-14

### Added

- Chatter plugin mode via `createTelephonyRoutes`
- Standalone server mode via `createStandaloneServer`
- Voice call support with Twilio webhooks (speech-to-text, TTS, conversation loops)
- SMS support with inbound/outbound messaging
- OpenAI-powered pre/post-processing pipeline (language detection, STT cleanup, channel formatting, translation)
- Structured flow engine with LLM intent detection and parameter extraction
- Human handoff with automatic transfer detection
- Multi-language support (English, French, German, Dutch, Spanish, Portuguese)
- Session persistence to Turso/libSQL (`talker_sessions`, `talker_messages` tables)
- HTTP chatbot client for remote API integration (standalone mode)
- In-memory conversation context management with TTL cleanup
- Configurable TTS voices per language (Amazon Polly defaults)
- Async acknowledgment pattern ("one moment please")
- No-speech retry logic with configurable max retries

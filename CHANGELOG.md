# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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

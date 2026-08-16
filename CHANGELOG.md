# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every merge to `main` publishes automatically (see [CONTRIBUTING.md](CONTRIBUTING.md#release-process)),
so this file cannot track every release one-for-one. From `v0.46.0` onward,
GitHub auto-generates a [release page](https://github.com/diegoaltoworks/talker/releases)
per tag with the complete per-version commit list. Most earlier tags have
none - the listener meant to generate them was broken for most of that span
(it did fire for `v0.16.0` and `v0.17.0`) until the `v0.46.0` release fixed it
for good. This file curates the notable and breaking changes, grouped under
the version they actually shipped in.

## [Unreleased]

### Added

- `talker_sessions.conversation_id` now populates for standalone
  `chatbot.url` deployments (previously always `NULL` - the column was
  threaded through but never read). It is a per-process log/DB correlation
  id, not a per-call or per-session identifier; see
  `src/core/chatbot/conversations.ts`'s docstring for the exact semantics.
- `TalkerStore` - a structural interface for session/message/status
  persistence, threaded through `TalkerDependencies.store`. Set
  `TalkerConfig.store` to bring your own (a different database, added
  instrumentation, a fake for tests); `createLibsqlTalkerStore` is the
  default Turso/libSQL implementation, exported for hosts that want it over
  a client they manage themselves. See the README's "Custom Session Store".
- `getPromptPhrase(language, key, languageDir)` - reads the new `prompts`
  namespace in `language/*.json`, which holds per-language instructions handed
  to the LLM rather than copy a caller ever hears.
- `normalizeReplyLanguages` - puts a configured `TalkerConfig.replyLanguages`
  into the shape reply-language matching expects. Applied automatically by
  `createTelephonyRoutes` and `createStandaloneServer`, so `['EN', 'pt-br']`
  now works where it previously matched nothing and narrowed every reply.
- `bun run check:deprecations` (`scripts/deprecations.ts`, part of `bun run
  check`) - fails when a `@deprecated` tag in `src/` names no removal version
  or hedges with without-notice language. See CONTRIBUTING.md's "Deprecating
  a public name".

### Removed

Everything below was deprecated during the 0.x window and is removed here,
ahead of the 1.0 API freeze. Names still reachable from the package root
(`getSmsPhrase`, `getWhatsAppPhrase`, `getExitMessage`,
`inputSanitizeMiddleware`) keep working and now carry a literal
`Removed in 1.0.0.` in their deprecation notice.

- `src/db/sessions.ts` and its no-`deps` exports (`upsertSession`,
  `insertMessage`, `upsertMessageStatus`, `saveSessionWithMessages`,
  `updateSessionIncremental`). Use `TalkerDependencies.store` (a
  `TalkerStore`), or `createLibsqlTalkerStore` over a client you manage.
  `generateId`/`generateSessionId` and the record types moved to
  `src/db/store.ts` and are re-exported from `@diegoaltoworks/talker` as
  before. Only `upsertMessageStatus` was reachable from the package root.
- `smsRoutes` / `whatsappRoutes`. Use `messagingRoutes(deps, registry, "sms")`
  and `messagingRoutes(deps, registry, "whatsapp")`.
- `getSanitizedBody`. Use `getTruncatedBody`. It was never exported from the
  package root.
- The compatibility type re-exports in `src/types.ts` (`TelephonyContext`,
  `Phrases`, `PhraseValue`, `IncomingResult` and the flow types). Every one of
  them is still exported from the package root, from the module that owns it,
  so no consumer import changes.
- The package root no longer re-exports this package's internal helpers:
  `clearAllContexts`, `incrementNoSpeechRetries`, `resetNoSpeechRetries`,
  `GLOBAL_LIMIT_KEY`, `pickDailyLimit` and `utcDayKey`. They remain exported
  from their own modules for this package's tests. Configure limits through
  `resolveVoiceLimitsConfig` and `createVoiceLimiter`.
- `phrases.replyLanguageMismatch` moved to `phrases.prompts.replyLanguageMismatch`.
  It is an instruction to the model, not copy anyone hears, and keeping it in
  the top-level shape invited a host to rewrite it as a greeting. A custom
  language file that still sets the old top-level key falls back to the
  built-in English instruction; move the key under `prompts` to keep the
  override.

### Changed

- **The `@diegoaltoworks/chatter` peer range is now `>=0.32.0 <2`** (was
  `>=0.32.0 <1`), so a host can co-install this package with a chatter 1.x.
  npm enforces a declared peer range even when the peer is `optional` -
  `optional` only stops npm auto-installing an absent peer - so under the old
  upper bound, the day chatter tags 1.0 every host installing latest-of-both
  gets a hard `ERESOLVE` with no fix but `--force`. Widening has to ship
  before that tag exists, which is why it lands here rather than in response
  to the break. `scripts/smoke-packed-install.sh` now co-installs the packed
  tarball with a chatter 1.0.0 stub under default npm resolution and fails if
  the pair is refused.

- **Plugin mode no longer opens its own database connection by default.**
  Previously `createTelephonyRoutes` always dialed a fresh Turso/libSQL
  connection (using talker's `database` config, or chatter's, as a
  fallback) even though chatter's own connection (`ServerDependencies.db`)
  was already live - a redundant second connection to the same database on
  every mount. It now reuses chatter's connection by default; set
  `TalkerConfig.database` explicitly if talker should persist to a
  *different* database than chatter's. One consequence: the legacy
  singleton client (`getDbClient()`, and `persistSession`/
  `persistFinalSession` when called without their trailing `store` argument)
  is populated in plugin mode only when `database` is set - a host relying on
  chatter's connection being reused implicitly now needs its own `database`
  config or should migrate to `deps.store`.
- `runMigrations` now takes an explicit `Client` argument (`resolveStore`
  always passes one). The no-argument call shape still works, falling back
  to the legacy singleton client exactly as before.
- `StandaloneConfig.cors` (previously declared but never wired to anything)
  now actually enables permissive CORS by default via `hono/cors`, matching
  its documented `Default: true`. Set `cors: false` to keep the previous
  no-CORS behavior.
- The shipped `language/*.json` files carry their native orthography again
  (accents in `de`/`es`/`fr`/`pt`, the Dutch `Één`, Spanish `¿`/`¡`). These
  strings are read aloud by TTS, where a stripped accent changes the vowel
  and a missing opening `¿` loses the intonation cue for the whole question.
  `src/core/phrase-files.test.ts` pins the spellings per file.
- A breaking change now ships a major version once the package is past 1.0
  (`feat!:`, or a `BREAKING CHANGE:` footer). Below 1.0.0 it still reaches
  minor and no further. See `scripts/next-version.ts`.
- `resolveStore` warns when `TalkerConfig.database` is half-filled (a url
  with an empty auth token, or the reverse) instead of silently mounting a
  store that persists nothing.
- The `INCOMING`, `OUTGOING` and `FLOW RESULT` log messages are now
  `incoming message processed`, `outgoing response processed` and
  `flow result`, matching the lower-case prose every other log line uses. Log
  *fields* are unchanged; a consumer matching on the old message strings
  needs updating.

## [0.54.0] - 2026-08-16

### Added

- Opt-in `TALKER_LOG_REDACT_KEYS` environment variable for full-field log
  redaction beyond the default phone/content-preview policy.

### Fixed

- Log redaction skipped phone numbers inside an array of raw strings under a
  phone-named key; Twilio's `From`/`To` fields are now included in the
  phone-key set alongside the previous `phoneNumber`/`phone`.
- The failed-flow transfer path now persists the "redirected" reason and
  clears context like the other two transfer paths do, closing a bookkeeping
  gap where this path alone left the session row saying "ended".
- `escapeXml` strips unpaired UTF-16 surrogates as a backstop. New
  `truncateGraphemeSafe` (`src/core/text.ts`) is now shared by input
  sanitization, transcript/synthesis limits, and the logger's content
  preview, so none of them can split a surrogate pair or a combining mark at
  the truncation boundary.

### Changed

- New `LEGACY_FLOW_CONTRACT_VERSION` decouples the default applied to a flow
  that omits `contractVersion` from `CURRENT_FLOW_CONTRACT_VERSION`, so a
  future contract version bump cannot silently relabel already-shipped
  legacy flows.
- The `@libsql/client` peer range is bounded to `<1`, matching the guard
  already applied to other peers with an open-ended major.

## [0.53.0] - 2026-08-16

### Fixed

- Flows spoke English to non-English callers: `src/flows/manager.ts` hardcoded
  "Could you provide more details?" and the cancellation keywords were English
  only, so a French caller mid-flow got an English prompt and could not leave
  the flow in their own language. Both now come from the phrase files
  (`flow.needMoreDetails`, `flow.cancellationKeywords`) in the caller's
  detected language, and keyword matching ignores accents so plain-ASCII
  phrase entries match accented speech-to-text output.

### Added

- `getCancellationKeywords(language, languageDir?)` and an optional
  `language`/`languageDir` on `shouldExitFlow`, for hosts that want the
  cancellation vocabulary of a given language or their own list via
  `languageDir`. Existing one-argument `shouldExitFlow` calls are unchanged:
  the default language's built-in list is the previous hardcoded one.

### Changed

- The `Phrases` type gained `flow.needMoreDetails` and
  `flow.cancellationKeywords`. Phrase *files* are unaffected (any missing key
  still falls back to the built-in English copy), but code that constructs a
  complete `Phrases` object now has two more required keys.

## [0.50.0] - 2026-08-16

### Added

- `./package.json` export entry, so tooling can resolve the installed
  manifest without guessing a path.

### Fixed

- The flow loader now validates an optional `contractVersion` in `flow.json`
  (defaults to 1, rejects out-of-range or non-integer values) instead of
  silently loading a contract it does not understand.
- The optional-peer-dependency static guard false-positived on inline `type`
  modifiers (`import { type X } from "peer"`) and missed a bare top-level
  `import()`/`await import()`, which is exactly as load-bearing as a static
  import.
- `.env.example`, the README, and the example app referenced
  `OPENAI_CHATGPT_KEY`, a variable the code has never read - only
  `OPENAI_API_KEY` is read.

### Deprecated

- `clearAllContexts`, `incrementNoSpeechRetries`, `resetNoSpeechRetries`,
  `GLOBAL_LIMIT_KEY`, `utcDayKey`, and `pickDailyLimit` leaked onto the
  package root re-export surface with no host use case and are marked
  `@deprecated`, kept working per this repo's deprecate-before-remove rule.

## [0.49.0] - 2026-08-16

### Fixed

- `escapeXml` strips XML-invalid control characters instead of passing them
  through.
- Input truncation is grapheme-cluster-safe (`Intl.Segmenter`), so it no
  longer splits a surrogate pair or an orphaned combining mark at the
  truncation boundary.
- `persistSession`/`persistFinalSession` session-row writes are ordered so a
  caller finalizing a transfer or ended call cannot have the terminal reason
  clobbered by the interim "ended" write.
- Context and rate-limit cleanup timers are `unref`'d and warn, instead of
  silently no-opping, on a second mount with a different config.
- `callOpenAI` honors a configurable base URL and aborts after a timeout, so
  a hung upstream request can no longer hold a Twilio webhook open
  indefinitely.

## [0.48.0] - 2026-08-16

### Changed

- Log redaction is now recursive: `redactData` walks nested objects and
  arrays (phone-redacting `phoneNumber`/`phone` at any depth, with a depth
  cap against circular payloads), instead of only inspecting top-level keys.
  Every other string field is now previewed to 160 characters by default
  where it previously logged verbatim - opt into full text with
  `TALKER_LOG_VERBOSE=true`. Diagnostic `error`/`stack` fields are exempt
  from the preview; `Date`/`Error` values now serialize properly instead of
  collapsing to `"{}"`.

### Fixed

- `shouldExitFlow`'s cancellation-keyword matching used plain substring
  matching (`"quite good"` false-positived on `"quit"`); it now uses the
  same word-boundary check `@diegoaltoworks/chatter/flows` ships.

## [0.45.0] - 2026-08-16

### Added

- `isValidLanguageCode`/`normalizeLanguage` (`^[a-z]{2,3}(-[A-Z]{2})?$`),
  exported for consumers that resolve languages themselves.

### Fixed

- **Security:** the LLM-detected language, which sticks for the session TTL,
  could reach a filesystem path or object index unvalidated. `loadPhrases`
  now normalizes before joining the filename, closing a path-traversal read
  (`../secret`) outside the language directory; `setDetectedLanguage` rejects
  a malformed code instead of storing it; `getVoiceConfig` reads both voice
  maps with `Object.hasOwn`, so a language code of `constructor` falls back
  to the English voice instead of an undefined one.

## [0.44.0] - 2026-08-16

### Fixed

- The bundled ESM output (`dist/index.mjs`) passed `__dirname` straight
  through and threw a `ReferenceError` on the first phrase or prompt lookup,
  breaking the README's import quick start on the first inbound webhook.
  `build:esm` now defines `__dirname` as `import.meta.dirname`; a new
  `src/core/assets.ts` resolves `language/` and `prompts/` by walking up
  from the running module to the package root instead of guessing a fixed
  relative path per build layout, and degrades to built-in defaults with a
  warning if the module directory is unavailable.

### Added

- `getIncomingPrompt`/`getOutgoingPrompt` exports, so the prompt actually in
  force is observable.

## [0.43.0] - 2026-08-16

### Fixed

- Several `src/core/context.ts` log calls interpolated the caller's phone
  number straight into the log message string (e.g. `` `context created for
  ${phoneNumber}` ``), which bypassed `logger`'s field-based redaction - that
  only redacts values under keys named `phoneNumber`/`phone`, not text baked
  into the message itself. Phone numbers now go through as a data field on
  every call, so they get redacted like everywhere else.
- The flow loader's schema check (`src/flows/loader.ts`) verified that
  `flow.json`'s `schema` object was non-empty, not that it had a `properties`
  key - a schema missing `properties` entirely passed validation here and
  then threw a `TypeError` deep inside parameter extraction instead of a
  clear load-time error. The check now validates `schema.properties`
  directly, which is also the exact shape a zero-parameter flow needs to keep
  working (this loader's reason for not delegating to chatter's loader).

### Changed

- The `sanitizedPhone`/`sanitized` locals in `src/db/persist.ts` and
  `src/db/sessions.ts` are renamed to `normalizedPhone`/`normalized` - they
  strip formatting characters for session-id stability, not for privacy; the
  number is stored as plaintext in `talker_sessions.phone_number` either way.
  No behavior change.

## [0.40.0] - 2026-08-15

### Changed

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

## [0.39.0] - 2026-08-15

### Fixed

- The last prompt stored for the no-speech retry ladder is now the unescaped
  text. The call processor used to escape before handing the prompt to
  `gatherTwiml`, so a retry concatenated escaped and unescaped copies and the
  `onMessage` tap reported bodies containing `&amp;` entities instead of what
  the caller heard.

## [0.36.0] - 2026-08-15

### Fixed

- TwiML helpers now escape every value they interpolate. `gatherTwiml`,
  `sayTwiml`, `transferTwiml`, `acknowledgmentTwiml` and `farewellTwiml`
  embedded text verbatim, so an `&`, `<` or `>` in a greeting, phrase, flow
  response or bot reply produced invalid XML - Twilio answered with error
  12100 and dropped the call. The hand-rolled TwiML in the initial-call
  handler escapes its greeting too. Callers must now pass plain text:
  pre-escaped input would be escaped twice and read out as entities.
  `escapeXml` also escapes apostrophes (`&apos;`), completing the five XML
  predefined entities.

## [0.35.0] - 2026-08-15

### Changed

- **Breaking:** telephony webhooks now fail closed without a Twilio auth token.
  `createTelephonyRoutes` and `createStandaloneServer` throw when
  `twilio.authToken` is absent, and `twilioSignatureMiddleware` rejects every
  request with 403 instead of passing it through. Previously a deployment that
  forgot the token exposed `/call`, `/sms` and `/whatsapp` to anyone who could
  reach them, with no signal that signatures were not being checked. Set
  `twilio.authToken`, or set `allowUnsignedWebhooks: true` to keep the old
  behaviour for development - that path mounts with a loud warning.

### Fixed

- Twilio signature validation no longer drops the query string when `publicUrl`
  is configured. Twilio signs the full URL it called, so a webhook configured
  with query parameters failed validation and was rejected as forged.

## [0.34.0] - 2026-08-15

### Fixed

- The `@diegoaltoworks/chatter` peer range is now `>=0.32.0 <1` instead of
  `^0.32.0`. A caret on a `0.x` version resolves to `>=0.32.0 <0.33.0`, so
  every chatter minor after 0.32 fell outside the range; installing the latest
  of both packages produced a peer conflict for a combination that works. CI
  now runs typecheck and the suite against `chatter@latest` in a dedicated job,
  alongside the existing job that pins the bottom of the range.

## [0.33.0] - 2026-08-15

### Fixed

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
  an LLM round trip - and it is what keeps the keyword-triggered handoff alive
  when the flow engine is unavailable.

### Changed

- **Breaking:** `initDbClient()` is now `async` and must be awaited - an
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

## [0.32.0] - 2026-08-14

### Changed

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

## [0.25.0] - 2026-08-14

### Added

- Channel-agnostic voice capabilities as root exports: `createSynthesizer`
  (text-to-speech), `createTranscriber` (speech-to-text), `parseOggOpus`
  (Ogg/Opus container inspection), and `createVoiceLimiter` /
  `resolveVoiceLimitsConfig` (per-number and global daily spend guards)
- `VoiceLimitsStore`, a structural interface letting a host back the daily
  counters with its own storage - talker takes on no database dependency

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

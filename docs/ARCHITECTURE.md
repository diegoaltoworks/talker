# Architecture

Talker is the voice/telephony modality adapter for
[`@diegoaltoworks/chatter`](https://github.com/diegoaltoworks/chatter): it
converts between a text-based brain and voice/SMS/WhatsApp webhooks -
speech-to-text, text-to-speech, Ogg/Opus handling, phrase rendering, TwiML
timing, and delivery status. Brain concerns (RAG assembly, persona
resolution, slot filling) live in chatter. See
[`adr/0001-modality-adapter-identity.md`](adr/0001-modality-adapter-identity.md)
for how that split was decided and what it implies for where new code goes.

For the call/message flow and directory layout, see the
[Architecture](../README.md#architecture) and
[Project Structure](../README.md#project-structure) sections of the README.
This document covers the invariants that hold across that structure - the
things a change must not break even though nothing stops a `tsc` pass from
breaking them.

## Invariants

Each of these is enforced by a test, not just a comment. If you touch code
near one, run its test file before and after - a green `bun run check` alone
doesn't prove the invariant survived, only that nothing else regressed.

### Fail-closed webhooks

Without a Twilio auth token there is no way to distinguish a genuine Twilio
request from a forged one, so signature validation rejects every request
with 403 unless a host explicitly opts into `allowUnsigned`. The same
guard preserves query strings when computing the signed URL, since Twilio
signs the full request URL including its query string.

- Implementation: `src/middleware/twilio-signature.ts`
- Test: `src/middleware/twilio-signature.test.ts` (`"should reject every
  request when no auth token is configured"` and the `signedRequestUrl`
  suite)

### Every branch delivers

`runVoiceReply`'s reserve -> download -> transcribe -> answer -> synthesize ->
send ladder guarantees a message reaches the caller on every path: a denied
reservation, a download/transcription/synthesis failure, or a voice-send
failure all fall back to text. Only a text-send failure is allowed to
surface to the caller as an error, because there is nothing left to fall
back to.

- Implementation: `src/voice/ladder.ts`
- Test: `src/voice/ladder.test.ts` - one case per failure branch, plus
  `"never calls download/transcribe/answer/synthesize once a fallback fires
  earlier in the ladder"` pinning the short-circuit behavior

### Phrase-file-only user-facing strings

Anything a caller hears or a texter reads comes from `language/*.json`
through `getPhrase`/`loadPhrases`, never a hardcoded string in route or
processing code. This is what makes the package usable in a caller's
language and lets a host override copy without forking code. Any phrase
entry may be a single string or a rotating array.

The rule covers text the package matches *against* the caller too, not only
text it speaks: flow cancellation keywords live in `flow.cancellationKeywords`
per language, so a caller can leave a flow in the language they are speaking
and a host can extend the list without forking. Matching is whole-word,
case-insensitive and accent-insensitive, which is why the shipped keyword
lists are plain ASCII while real speech-to-text output is not. Those lists
hold unambiguous cancellation forms only: a form that flips meaning under
negation ("don't forget my room number") is left out on purpose, because a
wrongly cancelled flow throws away everything the caller has said.

A phrase file is only half the rule: a lookup that always asks for `en`
speaks English no matter how many translations ship. Language detection runs
on the caller's first utterance and sticks for the life of the context, and
every phrase lookup after that turn resolves it with
`resolveLanguage(phoneNumber)` (`src/core/context.ts`), which falls back to
`DEFAULT_LANGUAGE`. The single deliberate exception is
`src/routes/call/handle-initial.ts`, which clears the context before the
caller has said anything, so it passes the named `DEFAULT_LANGUAGE` constant.

- Implementation: `src/core/phrases.ts`, `src/core/context.ts`
  (`resolveLanguage`), `src/flows/utils.ts` (cancellation keywords)
- Test: `src/core/phrases.test.ts`, `src/core/phrasesRotation.test.ts` cover
  the loader (`getPhrase`, fallbacks, path traversal);
  `src/flows/utils.test.ts` covers cancelling in every shipped language;
  `src/language-resolution.test.ts` drives each handler with a detected
  language and asserts the caller gets that language's copy and voice.
  "Never a hardcoded string" is a gate over all of `src/`
  (`src/phrase-guard.test.ts`), in four rules: no literal in a flow result's
  `response`/`smsContent`/`whatsappContent`; no TwiML markup outside
  `src/core/twiml.ts`; no literal message argument to a TwiML builder; no
  literal language argument to a phrase lookup. It catches the easy mistakes,
  not every shape of them - a literal hoisted into a named `const`, or a
  language code hoisted the same way, still passes. Beyond those shapes it
  stays convention - watch for it in review the way you'd watch for a stray
  `console.log`.

### Injected clients

Capability modules never construct a client or read `process.env`
themselves; a host injects `client: () => OpenAI` (or leaves it disabled).
This is what lets `src/voice/` and the flow engine's optional peers
(`openai`, `@diegoaltoworks/chatter`, `@libsql/client`) stay optional -
a hono-only install can import the package without any of them present, and
a disabled or misconfigured capability degrades to `null`/an actionable
error instead of throwing at module load.

- Implementation: `src/voice/synthesize.ts`, `src/voice/transcribe.ts`,
  `src/db/client.ts`, `src/flows/engine.ts`
- Test: `src/peer-deps.test.ts` (static: no top-level value import of an
  optional peer anywhere reachable from `src/index.ts`),
  `scripts/smoke-packed-install.sh` (dynamic: installs only `hono` and
  proves the package still imports and degrades actionably), and the
  narrower `src/seam-guards.test.ts` below

### Single-process state caveat

Rate limiting (`src/middleware/rate-limit.ts`) and pending-query tracking
(`src/routes/call/pending.ts`) live in module-level `Map`s and `setInterval`
sweeps. They are correct for a single process and nothing more: running
multiple instances behind a load balancer without sticky routing (or
without moving this state to `db/`, which is durable and shared) silently
fragments rate limits and loses in-flight call state across instances. This
is a deliberate scope boundary, not an oversight - call it out in any change
that adds new in-process state, and prefer the existing `db/` persistence
layer when state must survive a restart or be shared across instances.

Context/session bookkeeping (`src/core/context.ts`) is the one exception
with a partial escape hatch: it sits behind an injected, synchronous
`ContextStore` (the same structural-interface pattern as `VoiceLimitsStore`
in `src/voice/limits.ts`, though not its async contract - see the
`ContextStore` doc comment). `createInMemoryContextStore()` - a plain `Map`
- is what `TalkerConfig.contextStore` defaults to when left unset; a host
can inject another in-process implementation (an LRU with its own eviction
policy, a store instrumented for observability, a synchronous
embedded-DB-backed store for durability across restarts), but not a
networked or remote one without a larger async redesign this interface does
not attempt - so this remains single-process only in the same sense as
everything else on this list, just swappable within that constraint.
`src/core/chatbot/conversations.ts` (the standalone HTTP chatbot client's
per-phone-number history, keyed the same way) stays a plain module-level
`Map` - it has no such injection seam - but it does now get the same TTL
sweep as everything else, via `sweepConversations()`, wired into the shared
cleanup tick in `src/mount.ts`. Its `conversationId` is a
`crypto.randomUUID()` minted locally for log/DB correlation; it is never
sent to the remote chatbot and is not cleared when a call or message session
ends, so two calls from the same number reuse the same id until the process
restarts or the conversation is swept. `talker_sessions.conversation_id`
(see `src/db/persist.ts`) should be read as "which in-process chatbot
conversation produced this row," not as a per-call or per-session
identifier.

- Implementation: `src/middleware/rate-limit.ts`, `src/routes/call/pending.ts`,
  `src/core/context.ts`, `src/core/chatbot/conversations.ts`, `src/mount.ts`
  (see the "module-level singleton" doc comments in each)
- Test: `src/middleware/rate-limit.test.ts`, `src/core/context.test.ts` and
  `src/mount.test.ts` cover the single-process behavior and the
  `ContextStore` injection seam directly; there is intentionally no
  multi-process test, because there is no multi-process guarantee to prove.
  `src/core/chatbot/conversations.test.ts` covers the sweep; its
  `conversationId` behavior is covered indirectly via `src/db/persist.test.ts`

## No-untested-numbers rule

Every numeric constant that governs behavior a caller or texter can
perceive - timeouts, budgets, rate limits, retry counts, character limits -
ships with a test that pins the number, not just the code path around it. A
constant with no test asserting its value is free to drift during a refactor
without anyone noticing until it's in production. Examples already in the
codebase:

- `src/routes/call/handle-answer.ts`'s `DEFAULT_ANSWER_BUDGET_MS`, pinned at
  8000ms and asserted under Twilio's ~15s webhook timeout in
  `handle-answer.test.ts`
- `src/middleware/rate-limit.ts`'s `DEFAULT_MAX_REQUESTS` /
  `DEFAULT_WINDOW_MS`, pinned in `rate-limit.test.ts`
- `src/voice/limits.ts`'s `DEFAULT_GLOBAL_DAILY_LIMIT` /
  `DEFAULT_PER_NUMBER_DAILY_LIMIT`, pinned in `limits.test.ts`
- `src/voice/synthesize.ts`'s `DEFAULT_MAX_VOICE_TEXT_CHARS`, pinned in
  `synthesize.test.ts`

## Exemplar patterns

When a ticket doesn't name a precedent to follow, these are the load-bearing
examples worth copying the shape of:

- **Channel-agnostic capability factories** - `src/voice/` (`synthesize.ts`,
  `transcribe.ts`, `limits.ts`): plain functions taking an injected client
  and config, returning `null` on disabled/failure instead of throwing, with
  every export re-barreled from `src/voice/index.ts`. This is the shape any
  new capability module should take.
- **Hermetic tests against the real dependency's exports** -
  `src/core/chat.test.ts`: rather than hand-rolling a stand-in for
  chatter's `prepareChat`/`resolveBuckets`, it imports chatter's real
  implementations and only mocks the one seam under test (`answerOnce`).
  This catches wiring drift that a hand-rolled mock would hide. Prefer this
  over mocking a whole dependency when the dependency's own exports are
  cheap to call directly.
- **Static guard tests for runtime contracts** - `src/peer-deps.test.ts`:
  a contract that can only be proven by exercising the packed artifact
  (optional peers must never be load-bearing at import time) still gets a
  fast static test that catches the same class of regression before a
  publish, backed by the slower dynamic proof in
  `scripts/smoke-packed-install.sh`. Prefer adding both when a runtime
  contract is cheap to approximate statically.

## CI grep-gates

Some invariants are enforced structurally - by scanning source or a built
artifact for a call site in the wrong place - rather than by exercising
behavior and checking a return value:

| Gate | Enforces | Test |
|---|---|---|
| No `process.env` outside config seams | Capability modules stay injectable; env reads are confined to the few places that are explicitly about reading configuration | `src/seam-guards.test.ts` |
| No raw `fetch`/URL literal to `api.openai.com` outside `openai-request.ts` | Every outbound OpenAI call resolves its URL through the one place that honors a configurable base URL, rather than a call site bypassing it with the public default | `src/seam-guards.test.ts` |
| No hardcoded caller-facing text in `src/`: no literal `response`/`smsContent`/`whatsappContent`, no TwiML outside `src/core/twiml.ts`, no literal message into a TwiML builder, no literal language into a phrase lookup | Everything a caller hears or reads comes from the phrase files in the language they are speaking, rather than an English default frozen at a call site | `src/phrase-guard.test.ts` |
| Every `package.json` `exports` key resolves under both `import` and `require`, ships its declared types, and carries no test/map declarations | A subpath the build doesn't produce can't reach a consumer silently | `scripts/smoke-packed-install.sh`, run via `bun run test:packaged` |
| Every emitted `dist/**/*.{js,mjs}` bundle stays under its budget in `scripts/bundle-budgets.ts`, and every emitted bundle has a budget entry | Bundle-size creep (a new dependency pulled in, an accidental non-external import) is a build failure, not a silent regression discovered later | `scripts/bundle-budgets.ts`, run via `bun run check:bundle-budgets` |

The first three are `bun test` files, so `bun run check` (which runs
`bun test`) fails on a violation the same way it fails on a broken test. The
last two build `dist/` first (a packed tarball for the exports gate, plain
`esbuild` output for the bundle-budget gate) - too slow for the inner dev
loop - so they run as their own CI steps inside the "Packed tarball imports
and resolves every exports key" job, which already builds before testing.
Run them locally with `bun run test:packaged` (covers both) before a
release-shaped change to `package.json`'s `exports`/`files` or to a build
entry point.

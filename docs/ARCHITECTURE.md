# Architecture

Talker is the voice/telephony modality adapter for
[`@diegoaltoworks/chatter`](https://github.com/diegoaltoworks/chatter): it
converts between a text-based brain and voice/SMS/WhatsApp webhooks —
speech-to-text, text-to-speech, Ogg/Opus handling, phrase rendering, TwiML
timing, and delivery status. Brain concerns (RAG assembly, persona
resolution, slot filling) live in chatter. See
[`adr/0001-modality-adapter-identity.md`](adr/0001-modality-adapter-identity.md)
for how that split was decided and what it implies for where new code goes.

For the call/message flow and directory layout, see the
[Architecture](../README.md#architecture) and
[Project Structure](../README.md#project-structure) sections of the README.
This document covers the invariants that hold across that structure — the
things a change must not break even though nothing stops a `tsc` pass from
breaking them.

## Invariants

Each of these is enforced by a test, not just a comment. If you touch code
near one, run its test file before and after — a green `bun run check` alone
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

`runVoiceReply`'s reserve → download → transcribe → answer → synthesize →
send ladder guarantees a message reaches the caller on every path: a denied
reservation, a download/transcription/synthesis failure, or a voice-send
failure all fall back to text. Only a text-send failure is allowed to
surface to the caller as an error, because there is nothing left to fall
back to.

- Implementation: `src/voice/ladder.ts`
- Test: `src/voice/ladder.test.ts` — one case per failure branch, plus
  `"never calls download/transcribe/answer/synthesize once a fallback fires
  earlier in the ladder"` pinning the short-circuit behavior

### Phrase-file-only user-facing strings

Anything a caller hears or a texter reads comes from `language/*.json`
through `getPhrase`/`loadPhrases`, never a hardcoded string in route or
processing code. This is what makes the package usable in a caller's
language and lets a host override copy without forking code. Any phrase
entry may be a single string or a rotating array.

- Implementation: `src/core/phrases.ts`
- Test: `src/core/phrases.test.ts`, `src/core/phrasesRotation.test.ts` cover
  the loader (`getPhrase`, fallbacks, path traversal). The "never a
  hardcoded string in route code" half is convention, not a gate — there is
  no automated check for a raw string literal reaching a caller; watch for
  it in review the way you'd watch for a stray `console.log`.

### Injected clients

Capability modules never construct a client or read `process.env`
themselves; a host injects `client: () => OpenAI` (or leaves it disabled).
This is what lets `src/voice/` and the flow engine's optional peers
(`openai`, `@diegoaltoworks/chatter`, `@libsql/client`) stay optional —
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

Rate limiting (`src/middleware/rate-limit.ts`), pending-query tracking
(`src/routes/call/pending.ts`), and context/session bookkeeping
(`src/core/context.ts`) all live in module-level `Map`s and `setInterval`
sweeps. They are correct for a single process and nothing more: running
multiple instances behind a load balancer without sticky routing (or
without moving this state to `db/`, which is durable and shared) silently
fragments rate limits and loses in-flight call state across instances. This
is a deliberate scope boundary, not an oversight — call it out in any change
that adds new in-process state, and prefer the existing `db/` persistence
layer when state must survive a restart or be shared across instances.

- Implementation: `src/middleware/rate-limit.ts`, `src/routes/call/pending.ts`,
  `src/core/context.ts` (see the "module-level singleton" doc comments in
  each)
- Test: `src/middleware/rate-limit.test.ts`, `src/core/context.test.ts`
  cover the single-process behavior directly; there is intentionally no
  multi-process test, because there is no multi-process guarantee to prove

## No-untested-numbers rule

Every numeric constant that governs behavior a caller or texter can
perceive — timeouts, budgets, rate limits, retry counts, character limits —
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

- **Channel-agnostic capability factories** — `src/voice/` (`synthesize.ts`,
  `transcribe.ts`, `limits.ts`): plain functions taking an injected client
  and config, returning `null` on disabled/failure instead of throwing, with
  every export re-barreled from `src/voice/index.ts`. This is the shape any
  new capability module should take.
- **Hermetic tests against the real dependency's exports** —
  `src/core/chat.test.ts`: rather than hand-rolling a stand-in for
  chatter's `prepareChat`/`resolveBuckets`, it imports chatter's real
  implementations and only mocks the one seam under test (`answerOnce`).
  This catches wiring drift that a hand-rolled mock would hide. Prefer this
  over mocking a whole dependency when the dependency's own exports are
  cheap to call directly.
- **Static guard tests for runtime contracts** — `src/peer-deps.test.ts`:
  a contract that can only be proven by exercising the packed artifact
  (optional peers must never be load-bearing at import time) still gets a
  fast static test that catches the same class of regression before a
  publish, backed by the slower dynamic proof in
  `scripts/smoke-packed-install.sh`. Prefer adding both when a runtime
  contract is cheap to approximate statically.

## CI grep-gates

Three invariants are enforced structurally — by scanning source or a built
artifact for a call site in the wrong place — rather than by exercising
behavior and checking a return value:

| Gate | Enforces | Test |
|---|---|---|
| No `process.env` outside config seams | Capability modules stay injectable; env reads are confined to the few places that are explicitly about reading configuration | `src/seam-guards.test.ts` |
| No raw `fetch`/URL literal to `api.openai.com` outside the OpenAI client module | Every outbound OpenAI call goes through the one place that honors a configurable base URL and abort/timeout | `src/seam-guards.test.ts` |
| Every `package.json` `exports` key resolves under both `import` and `require`, ships its declared types, and carries no test/map declarations | A subpath the build doesn't produce can't reach a consumer silently | `scripts/smoke-packed-install.sh`, run via `bun run test:packaged` |

The first two are `bun test` files, so `bun run check` (which runs
`bun test`) fails on a violation the same way it fails on a broken test. The
third is not part of `bun run check` — it builds and packs a tarball, which
is too slow for the inner dev loop — so it runs as its own CI job ("Packed
tarball imports and resolves every exports key"). Run it locally with
`bun run test:packaged` before a release-shaped change to `package.json`'s
`exports` or `files`.

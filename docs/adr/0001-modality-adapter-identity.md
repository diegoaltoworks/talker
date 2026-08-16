# ADR 0001: Talker is the modality adapter, not the brain

## Status

Accepted.

## Context

Talker started as a Twilio plugin for chatter and grew a hand-rolled RAG
prompt assembly (`src/core/chat.ts`), a flow engine with its own intent
detection and slot filling (`src/flows/`), and persona/session logic that
duplicated concerns chatter also needed to solve for its other channels.
That duplication meant two places to fix a prompt-assembly bug, two places
a new channel had to learn persona resolution, and no shared seam a
non-telephony host could reuse.

## Decision

Talker's scope is the **voice/telephony modality adapter**: it converts
between chatter's text-based brain and voice/SMS/WhatsApp transports.
Concretely, talker owns:

- Speech-to-text and text-to-speech (`src/voice/`), Ogg/Opus container
  inspection, and per-caller/per-day spend limits
- TwiML generation and call timing (`src/core/twiml.ts`,
  `src/routes/call/`)
- Phrase rendering and localization (`src/core/phrases.ts`, `language/`)
- Delivery status and message-tap observability
  (`onMessageStatus`/`onMessage`)
- Flow **presentation**: rendering slot questions and results into
  speakable voice phrasing, SMS/WhatsApp text, and the
  ack-then-deliver-out-of-band pattern for slow handlers; directory loading
  (`src/flows/loader.ts`), the registry, and session persistence
  (`src/db/sessions.ts`) also stay in talker, since they're specific to how
  *this* package discovers and tracks a flow, not brain logic

Brain concerns move to chatter, which owns them for every channel chatter
supports, not just telephony:

- RAG assembly and prompt sandwiching (`prepareChat`, consumed via
  `personaLayer`/`channelHint`/`buckets` in `src/core/chat.ts`)
- Persona resolution
- Flow **logic**: intent detection and parameter extraction, sourced from
  chatter's `@diegoaltoworks/chatter/flows` export (`src/flows/engine.ts`,
  loaded on first use so the peer stays optional) instead of a duplicate
  implementation. Talker keeps the `flow.json` + handler + instructions
  contract stable around this swap, so existing flow directories work
  unchanged

The dividing line is: if the same logic would need to exist again for a
hypothetical non-telephony channel, it belongs in chatter. If it's specific
to what a phone call or an SMS/WhatsApp message can express, it belongs in
talker.

## Consequences

- New capability code defaults to `src/voice/`-style channel-agnostic
  factories with injected clients (see
  [`ARCHITECTURE.md`](../ARCHITECTURE.md#exemplar-patterns)), not routes
  options — a Baileys-only or non-Twilio host should be able to call them
  directly.
- Changes that touch prompt assembly, persona resolution, or intent/slot
  logic belong in chatter first; talker consumes the resulting seam rather
  than re-implementing it. Tickets that need a seam chatter doesn't have yet
  are blocked until chatter publishes it — check the peer range in
  `package.json` before starting.
- Talker's flow directory loader intentionally does not delegate to
  chatter's loader: chatter's schema check requires at least one property,
  which would silently drop talker's zero-parameter, keyword-triggered flows
  (see `src/flows/loader.ts`'s doc comment). That divergence is a deliberate
  exception to "logic lives in chatter," not a residual to migrate away.
- This ADR does not cover streaming/realtime voice, which is out of scope
  for this decision; the injected-client seam is deliberately kept general
  enough not to preclude it later.

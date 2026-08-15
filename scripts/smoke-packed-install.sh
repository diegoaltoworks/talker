#!/usr/bin/env bash
#
# Packed-tarball smoke test: install the published artifact into a throwaway
# project that has ONLY hono, and prove it imports.
#
# The optional peers (@diegoaltoworks/chatter, @libsql/client, openai) are
# deliberately absent. npm does not auto-install peers marked optional, so this
# reproduces exactly what a host following the standalone quick start gets. Any
# top-level value import of an optional peer makes the import below throw —
# which is invisible in this repo's own test run, where all three are
# devDependencies.
#
# The static counterpart is src/peer-deps.test.ts. Run this with
# `bun run test:packaged`; CI runs it on every push.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> Building dist"
(cd "$repo" && bun run build >/dev/null)

echo "==> Packing tarball"
tarball="$(cd "$repo" && npm pack --silent --pack-destination "$work")"
tarball="$work/$tarball"

echo "==> Installing $(basename "$tarball") with only hono"
cd "$work"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund hono "$tarball"

echo "==> Asserting the package imports and degrades actionably"
node --input-type=module -e '
const assert = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`ok - ${message}`);
};

// The load-bearing assertion: this line throws if any optional peer is
// imported at module scope.
const talker = await import("@diegoaltoworks/talker");

for (const name of [
  "createStandaloneServer",
  "createTelephonyRoutes",
  "createSynthesizer",
  "parseOggOpus",
  "processFlow",
  "initDbClient",
  "FlowRegistry",
]) {
  assert(typeof talker[name] === "function", `exports ${name}`);
}

// Voice-only usage: channel-agnostic factories work with the OpenAI SDK absent
// because the client is injected and never constructed on the disabled path.
const synthesize = talker.createSynthesizer({
  client: () => {
    throw new Error("client must not be constructed while disabled");
  },
  enabled: () => false,
});
assert((await synthesize("hello")) === null, "disabled synthesizer returns null without openai");

// Configured persistence with no driver installed is a deployment mistake, and
// says so.
const dbError = await talker
  .initDbClient("libsql://example.turso.io", "token")
  .then(() => null, (error) => error);
assert(dbError instanceof Error, "initDbClient rejects without @libsql/client");
assert(
  dbError.message.includes("@libsql/client"),
  `initDbClient error names the peer: ${dbError.message}`,
);

// Same for the flow engine: absent chatter is reported where flows are used.
const engineError = await new talker.FlowRegistry("")
  .getEngine()
  .then(() => null, (error) => error);
assert(engineError instanceof Error, "flow engine rejects without @diegoaltoworks/chatter");
assert(
  engineError.message.includes("@diegoaltoworks/chatter"),
  `flow engine error names the peer: ${engineError.message}`,
);
'

echo "==> Packed install smoke test passed"

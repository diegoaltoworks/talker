#!/usr/bin/env bash
#
# Packed-tarball smoke test: install the published artifact into a throwaway
# project that has ONLY hono, and prove it imports — then prove every exports
# key resolves under both import and require, and that no test declarations
# shipped.
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

// Every exports key must resolve under every condition. A subpath whose
// bundle the build never emits resolves for types and throws at runtime, so
// import and require are both exercised against the installed artifact.
const { createRequire } = await import("node:module");
const fs = await import("node:fs");
const path = await import("node:path");

const req = createRequire(path.join(process.cwd(), "resolve.cjs"));
const pkgDir = path.join(process.cwd(), "node_modules", "@diegoaltoworks", "talker");
const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));

for (const [key, conditions] of Object.entries(manifest.exports ?? {})) {
  const specifier = key === "." ? "@diegoaltoworks/talker" : `@diegoaltoworks/talker/${key.slice(2)}`;
  assert(
    conditions !== null && typeof conditions === "object",
    `${specifier} declares conditions as an object`,
  );

  const esm = await import(specifier);
  assert(Object.keys(esm).length > 0, `${specifier} resolves via import`);

  const cjs = req(specifier);
  assert(Object.keys(cjs).length > 0, `${specifier} resolves via require`);

  assert(
    fs.existsSync(path.join(pkgDir, conditions.types)),
    `${specifier} ships ${conditions.types}`,
  );
}

const twilio = await import("@diegoaltoworks/talker/twilio");
assert(typeof twilio.sendSMS === "function", "subpath exports sendSMS");
assert(typeof twilio.sendWhatsApp === "function", "subpath exports sendWhatsApp");

// The packaged language/ and prompts/ directories are located relative to the
// running module, and that resolution is the one thing that genuinely differs
// between source, the ESM bundle and the CJS bundle. Resolving an export only
// proves the module loaded, so exercise a real lookup of each asset kind in
// both bundles and compare it against the shipped file: a bundle that cannot
// reach its assets answers with the inlined defaults instead of failing loudly.
const french = JSON.parse(fs.readFileSync(path.join(pkgDir, "language/fr.json"), "utf8"));
const incoming = fs.readFileSync(path.join(pkgDir, "prompts/incoming.md"), "utf8");
const outgoing = fs.readFileSync(path.join(pkgDir, "prompts/outgoing.md"), "utf8");

for (const [format, mod] of [["esm", talker], ["cjs", req("@diegoaltoworks/talker")]]) {
  assert(
    mod.loadPhrases("fr").greeting === french.greeting,
    `${format}: loadPhrases reads the packaged language file`,
  );
  assert(
    mod.getPhrase("fr", "transfer") === french.transfer,
    `${format}: getPhrase resolves through the packaged language file`,
  );
  assert(
    mod.getIncomingPrompt({ config: {} }) === incoming,
    `${format}: getIncomingPrompt reads the packaged prompt file`,
  );
  assert(
    mod.getOutgoingPrompt({ config: {} }) === outgoing,
    `${format}: getOutgoingPrompt reads the packaged prompt file`,
  );
}

// Test scaffolding and declaration maps are build fallout, not API: the maps
// point at sources this package does not publish.
const stray = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(test|fixtures)\.d\.ts$/.test(entry.name) || entry.name.endsWith(".d.ts.map")) {
      stray.push(path.relative(pkgDir, full));
    }
  }
};
walk(path.join(pkgDir, "dist"));
assert(stray.length === 0, `no test or map declarations shipped (found ${stray.length})`);
'

echo "==> Packed install smoke test passed"

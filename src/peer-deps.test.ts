import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Optional peer dependencies must never be load-bearing at module load.
 *
 * `openai`, `@libsql/client` and `@diegoaltoworks/chatter` are declared
 * optional, so a host may install talker with only hono. A single top-level
 * value import of any of them — anywhere reachable from src/index.ts — makes
 * `import "@diegoaltoworks/talker"` throw for that host: a break that never
 * shows up in this repo's own test run, because this repo installs all of
 * them as devDependencies.
 *
 * Each peer therefore has a first-use loader: `./flows/engine.ts` for
 * chatter's flow engine, the dynamic import in `./db/client.ts` for libSQL,
 * `./standalone.ts` and the injected clients in `./voice/` for openai.
 *
 * This guard is the static half of the contract; the packed-tarball smoke
 * test (`bun run test:packaged`, run in CI) is the dynamic half.
 */

const SRC = import.meta.dir;

/** Optional peers, read from the manifest so the two cannot drift apart. */
function optionalPeers(): string[] {
  const manifest = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  return Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta.optional)
    .map(([name]) => name);
}

/** Declared peer ranges, keyed by package name. */
function peerRanges(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
    peerDependencies?: Record<string, string>;
  };
  return manifest.peerDependencies ?? {};
}

/** Every non-test .ts file under src/, recursively. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".fixtures.ts")
    ) {
      files.push(path);
    }
  }
  return files;
}

/**
 * True when a `from`-clause imports nothing but types, so it compiles away
 * entirely and cannot be load-bearing at runtime.
 *
 * `import type { ... }` (clause starts with the `type` keyword) is the
 * common case, but TS also allows an inline modifier on individual named
 * imports — `import { type Foo } from "openai"` — which is equally
 * type-only even though the clause itself does not start with `type`. A
 * clause is type-only either way, or when every entry in a brace-delimited
 * named-import list carries the inline modifier.
 */
function isTypeOnlyClause(clause: string): boolean {
  if (/^type\b/.test(clause)) return true;
  const braces = clause.match(/^\{([^}]*)\}$/);
  if (!braces) return false;
  const entries = braces[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 && entries.every((entry) => /^type\b/.test(entry));
}

/**
 * Blanks out comments and string/template literals, preserving line breaks
 * and the length of everything else, so a later scan for code shapes (an
 * `import(` call, a brace) cannot match text that only *looks* like code
 * because it sits inside a comment or a string. Line/column positions of
 * real matches are unaffected, which matters because the scope check below
 * walks the surrounding source by character offset.
 */
function stripCommentsAndStrings(source: string): string {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (match) => match.replace(/[^\n]/g, " "),
  );
}

/**
 * True when the character at `index` sits outside every enclosing `{...}`
 * block — i.e. is not inside a function body (deferred until called), an
 * `if`/`try`/`for` block, or any other braced construct — and is not the
 * body of a brace-less arrow function (`() => import(...)`), which is how a
 * lazy loader reads when short enough that the formatter keeps it on one
 * line. `source` must already be comment/string-stripped so brace counting
 * only sees real code.
 *
 * This is a heuristic, not a parser: it cannot distinguish a function body
 * from a non-function block at the same brace depth (see the "known
 * limitation" case in the test below), but it does correctly admit the
 * deferred, in-function form every first-use loader in this codebase uses,
 * while catching a bare top-level call with no wrapping at all.
 */
function isInsideDeferredScope(source: string, index: number): boolean {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  if (depth > 0) return true;
  return /=>\s*$/.test(source.slice(0, index));
}

/**
 * Specifiers of every top-level import that survives to runtime.
 *
 * Statement-based rather than line-based: a multi-line `import type { ... }
 * from "..."` puts the specifier on a line that carries no `type` keyword, so
 * a per-line check reports it as a value import. `export ... from "x"` counts
 * too — a re-export loads the module exactly like an import does, and this
 * package's entry point is built almost entirely from re-export lines.
 * Side-effect imports (`import "x"`) count as value imports; `import type`,
 * `export type` and an all-`type`-modifier named-import list do not.
 *
 * The clause cannot contain `;`, which stops the lazy match from running past
 * the end of a preceding statement and misreading two statements as one.
 *
 * `^` is anchored at column 0, not merely start-of-line, deliberately: every
 * static `import`/`export` declaration in valid ESM is a top-level statement
 * (the parser hoists them; they cannot legally appear indented inside a
 * block), so column 0 is where a real one always lands.
 *
 * A *dynamic* `import()` call is a different shape: it is an expression, not
 * a declaration, so it can legally appear anywhere — including deferred
 * inside a function, which is how every sanctioned first-use loader in this
 * codebase defers its peer import. A bare top-level `await import(...)` is
 * just as load-bearing as a static import, though, so it is scanned
 * separately with `isInsideDeferredScope` rather than the column-0 anchor.
 */
function runtimeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  const declarations = /^(?:import|export)\s+(?<clause>[^;]*?)\s*from\s*["'](?<spec>[^"']+)["']/gm;
  for (const match of source.matchAll(declarations)) {
    const { clause, spec } = match.groups as { clause: string; spec: string };
    if (!isTypeOnlyClause(clause)) specifiers.push(spec);
  }

  const sideEffects = /^import\s*["'](?<spec>[^"']+)["']/gm;
  for (const match of source.matchAll(sideEffects)) {
    specifiers.push((match.groups as { spec: string }).spec);
  }

  const stripped = stripCommentsAndStrings(source);
  // Matched against the ORIGINAL source, not the stripped one, so a real
  // call's specifier text survives (stripping blanks string contents too,
  // which would erase the very specifier this is trying to read). `stripped`
  // is instead used to confirm the match itself is real code — not text that
  // merely looks like a call inside a comment or a string literal — and to
  // count brace depth without braces that live inside a string throwing it off.
  const dynamicImports = /\bimport\s*\(\s*["'](?<spec>[^"']+)["']/g;
  for (const match of source.matchAll(dynamicImports)) {
    const isRealCode = stripped.startsWith("import", match.index);
    if (isRealCode && !isInsideDeferredScope(stripped, match.index)) {
      specifiers.push((match.groups as { spec: string }).spec);
    }
  }

  return specifiers;
}

function importsPeer(specifier: string, peer: string): boolean {
  return specifier === peer || specifier.startsWith(`${peer}/`);
}

describe("optional peer dependencies", () => {
  const peers = optionalPeers();
  const files = sourceFiles(SRC);

  it("declares the peers this guard expects to police", () => {
    expect(peers.sort()).toEqual(["@diegoaltoworks/chatter", "@libsql/client", "openai"]);
  });

  it("walks the whole source tree, so the guard cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(30);
    // Files that used to hold the offending top-level imports.
    for (const name of ["flows/manager.ts", "flows/registry.ts", "db/client.ts"]) {
      expect(files).toContain(join(SRC, name));
    }
  });

  it.each(peers)("imports %s for types only, everywhere under src", (peer) => {
    const offenders = files.filter((file) =>
      runtimeImportSpecifiers(readFileSync(file, "utf8")).some((spec) => importsPeer(spec, peer)),
    );

    expect(offenders.map((file) => file.slice(SRC.length + 1))).toEqual([]);
  });

  it("classifies the import forms a naive line-based check gets wrong", () => {
    const cases: Array<[string, string[]]> = [
      ['import type {\n  Client,\n} from "@libsql/client";\n', []],
      ['import {\n  createClient,\n} from "@libsql/client";\n', ["@libsql/client"]],
      ['import "openai";\n', ["openai"]],
      // A re-export loads the module just as an import does.
      ['export { createClient } from "@libsql/client";\n', ["@libsql/client"]],
      ['export type { Client } from "@libsql/client";\n', []],
      ['export * from "openai";\n', ["openai"]],
      // The clause must not run past the end of the statement before it.
      ['import "./instrument";\nimport type { Client } from "@libsql/client";\n', ["./instrument"]],
      // An inline `type` modifier on every named import is type-only even
      // though the clause itself does not start with the `type` keyword.
      ['import { type Client } from "@libsql/client";\n', []],
      // A mix of type and value entries is still a value import.
      ['import { type Client, createClient } from "@libsql/client";\n', ["@libsql/client"]],
      // A bare top-level dynamic import runs at module load, exactly like a
      // static import — unlike the deferred form every sanctioned first-use
      // loader in this codebase uses.
      ['await import("openai");\n', ["openai"]],
      ['import("openai");\n', ["openai"]],
      // The deferred form is the sanctioned first-use-loader pattern and
      // must not be flagged, whether wrapped in a braced function body or
      // written as a brace-less arrow (both shapes appear in this codebase,
      // the latter whenever the call is short enough that the formatter
      // keeps it on one line instead of wrapping it under `=>`).
      ['export function load() {\n  return import("openai");\n}\n', []],
      ['export const load = () => import("openai");\n', []],
      ['export const load = () =>\n  import("openai");\n', []],
      // Code-shaped text inside a comment or a string is not code.
      ['// a deferred import("openai") is fine\n', []],
      ['const msg = "call import(\\"openai\\") yourself";\n', []],
      // Known limitation: a dynamic import wrapped in a non-function block
      // at true module scope (not deferred — this runs immediately, same as
      // the bare form above) shares its brace depth with a function body and
      // is not distinguished from one. Not currently caught; documented here
      // rather than left silently unverified.
      ['if (needsOpenAI) {\n  await import("openai");\n}\n', []],
    ];

    for (const [source, expected] of cases) {
      expect(runtimeImportSpecifiers(source)).toEqual(expected);
    }
  });

  it("matches subpath imports of a peer", () => {
    expect(importsPeer("@diegoaltoworks/chatter/flows", "@diegoaltoworks/chatter")).toBe(true);
    expect(importsPeer("@diegoaltoworks/chatter-extras", "@diegoaltoworks/chatter")).toBe(false);
  });
});

/**
 * Peer ranges must admit the versions their packages actually ship.
 *
 * Under semver, `^0.32.0` means `>=0.32.0 <0.33.0` — a caret on a 0.x version
 * pins one minor, because every 0.x minor is treated as a breaking major. Peers
 * that release minors faster than this package does therefore fall out of range
 * within days, and a host installing latest-of-both gets a peer conflict for a
 * combination that works fine. Pre-1.0 peers get an explicit `>=x.y.z <major`.
 *
 * The upper bound has to lead the peer, not follow it. npm refuses to resolve
 * an installed peer that sits outside the declared range even when the peer is
 * `optional` (optional only stops npm auto-installing an absent one), so the
 * moment chatter tags 1.0 every host on latest-of-both gets a hard ERESOLVE
 * until a talker release widens the range - and that release cannot be
 * back-dated. `<2` is therefore declared before chatter's 1.0 exists.
 */
describe("peer dependency ranges", () => {
  const peers = peerRanges();

  it("reads the ranges it is about to police", () => {
    expect(Object.keys(peers).sort()).toEqual([
      "@diegoaltoworks/chatter",
      "@libsql/client",
      "hono",
      "openai",
    ]);
  });

  it.each(Object.entries(peers))("does not caret-pin %s to a single 0.x minor", (_peer, range) => {
    expect(range.match(/\^\s*0\./g)).toBeNull();
  });

  it("admits chatter minors published after this release", () => {
    expect(peers["@diegoaltoworks/chatter"]).toBe(">=0.32.0 <2");
  });

  it("admits a chatter 1.x a host installs alongside this release", () => {
    // The version-level statement of the range above, and the one that
    // actually matters: chatter's 1.0 is the release npm currently refuses to
    // resolve against, so it is asserted by version rather than only by the
    // range's spelling. 2.0.0 stays out - widening past the next major would
    // promise compatibility with an API nobody has designed yet.
    const range = peers["@diegoaltoworks/chatter"];
    for (const version of ["0.32.0", "0.61.0", "1.0.0", "1.7.3"]) {
      expect([version, Bun.semver.satisfies(version, range)]).toEqual([version, true]);
    }
    for (const version of ["0.31.0", "2.0.0"]) {
      expect([version, Bun.semver.satisfies(version, range)]).toEqual([version, false]);
    }
  });

  it("gives every peer an explicit upper bound", () => {
    // A floor like ">=0.6.0" with nothing above it admits every future
    // release, including one with a breaking change - the exact caret-pin
    // problem the test above guards against, just spelled without a caret.
    // Checked generically (not by name) so a new peer is covered the moment
    // it is declared, not only after someone remembers to add a case.
    const unbounded = Object.entries(peers).filter(
      ([, range]) => !/<\s*\d/.test(range) && !/[\^~]/.test(range),
    );
    expect(unbounded).toEqual([]);
  });
});

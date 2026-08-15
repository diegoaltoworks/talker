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
 * Specifiers of every top-level import that survives to runtime.
 *
 * Statement-based rather than line-based: a multi-line `import type { ... }
 * from "..."` puts the specifier on a line that carries no `type` keyword, so
 * a per-line check reports it as a value import. `export ... from "x"` counts
 * too — a re-export loads the module exactly like an import does, and this
 * package's entry point is built almost entirely from re-export lines.
 * Side-effect imports (`import "x"`) count as value imports; `import type` and
 * `export type` do not.
 *
 * The clause cannot contain `;`, which stops the lazy match from running past
 * the end of a preceding statement and misreading two statements as one.
 */
function runtimeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  const declarations = /^(?:import|export)\s+(?<clause>[^;]*?)\s*from\s*["'](?<spec>[^"']+)["']/gm;
  for (const match of source.matchAll(declarations)) {
    const { clause, spec } = match.groups as { clause: string; spec: string };
    if (!/^type\b/.test(clause)) specifiers.push(spec);
  }

  const sideEffects = /^import\s*["'](?<spec>[^"']+)["']/gm;
  for (const match of source.matchAll(sideEffects)) {
    specifiers.push((match.groups as { spec: string }).spec);
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

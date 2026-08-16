import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two structural invariants, checked by scanning `src/` rather than by
 * exercising behavior, because the violation is a call site in the wrong
 * place rather than a wrong return value:
 *
 * - `process.env` is confined to config seams (currently just
 *   `core/logger.ts`) so capability modules stay injectable and testable
 *   without env stubbing.
 * - `api.openai.com` is confined to the one module
 *   (`core/processing/openai-request.ts`) that resolves it against a
 *   configurable `baseUrl`, so no call site can silently bypass the override.
 *
 * See `docs/ARCHITECTURE.md`'s "Injected clients" invariant and "CI
 * grep-gates" table.
 */

const SRC = import.meta.dir;

const GUARDS = [
  { name: "process.env", needle: "process.env", allowed: ["core/logger.ts"] },
  {
    name: "api.openai.com",
    needle: "api.openai.com",
    allowed: ["core/processing/openai-request.ts"],
  },
];

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
 * Blanks out comments only, leaving string and template literal contents
 * untouched — unlike `src/peer-deps.test.ts`'s `stripCommentsAndStrings`,
 * these guards need to read text that lives *inside* a string (a URL). The
 * string/template alternatives exist in the pattern purely so a `//` or
 * `/*` inside one is consumed as part of the string and never misread as a
 * comment start (e.g. the `://` in `"https://api.openai.com"`, or the glob
 * in `"/call/*"`).
 */
function stripComments(source: string): string {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (match) =>
      match.startsWith("//") || match.startsWith("/*") ? match.replace(/[^\n]/g, " ") : match,
  );
}

/** 1-indexed line numbers where `needle` appears outside a comment. */
function findUses(content: string, needle: string): number[] {
  const stripped = stripComments(content);
  const hits: number[] = [];
  stripped.split("\n").forEach((line, index) => {
    if (line.includes(needle)) hits.push(index + 1);
  });
  return hits;
}

describe("findUses", () => {
  it("ignores a line comment", () => {
    expect(findUses("// process.env.X\nconst x = 1;", "process.env")).toEqual([]);
  });

  it("ignores a block comment on its own lines", () => {
    expect(findUses("/**\n * process.env.X\n */\nconst x = 1;", "process.env")).toEqual([]);
  });

  it("ignores a block comment sharing a line with code", () => {
    expect(findUses("/* process.env.X */ const x = 1;", "process.env")).toEqual([]);
  });

  it("ignores code sharing a line with a trailing block comment", () => {
    expect(findUses("const x = cfg.key; /* not process.env */", "process.env")).toEqual([]);
  });

  it("ignores a multi-line block comment that starts mid-line", () => {
    expect(findUses("foo(); /* start\nprocess.env.X\n*/", "process.env")).toEqual([]);
  });

  it("flags a real read", () => {
    expect(findUses('return process.env.NODE_ENV === "test";', "process.env")).toEqual([1]);
  });

  it("does not mistake a URL scheme separator for a comment", () => {
    const content = 'const url = "https://api.openai.com/v1/chat/completions";';
    expect(findUses(content, "api.openai.com")).toEqual([1]);
  });

  it("does not mistake a protocol-relative URL for a comment", () => {
    expect(findUses('const url = "//api.openai.com/v1";', "api.openai.com")).toEqual([1]);
  });

  it("does not mistake a route glob for a comment", () => {
    expect(findUses('app.use("/call/*", middleware);', "process.env")).toEqual([]);
  });

  it("ignores a doc-comment mention of the default URL", () => {
    const content = ["/**", ' * Default: "https://api.openai.com/v1/chat/completions"', " */"].join(
      "\n",
    );
    expect(findUses(content, "api.openai.com")).toEqual([]);
  });
});

describe.each(GUARDS)("$name confined to its allowlisted files", ({ needle, allowed }) => {
  const files = sourceFiles(SRC);

  it("walks the whole source tree, so the guard cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has an allowlist that still actually uses the needle", () => {
    for (const relative of allowed) {
      const content = readFileSync(join(SRC, relative), "utf8");
      expect(findUses(content, needle).length).toBeGreaterThan(0);
    }
  });

  it("appears nowhere else", () => {
    const allowedFull = new Set(allowed.map((relative) => join(SRC, relative)));
    const violations: string[] = [];
    for (const file of files) {
      if (allowedFull.has(file)) continue;
      const content = readFileSync(file, "utf8");
      for (const line of findUses(content, needle)) {
        violations.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

/**
 * `replyLanguages` is normalized where a mount is built, not per request.
 * Matching in `resolveReplyLanguage` is exact, so a mis-cased entry that
 * reaches it narrows every reply to a code nothing matches and apologizes for
 * it, with no error anywhere. Both entry points have to apply the
 * normalization; a new one that forgets is the failure this catches, and it
 * is a call site rather than a wrong return value, so it is checked here
 * beside the other structural guards.
 */
describe("replyLanguages is normalized at mount time", () => {
  for (const entryPoint of ["plugin.ts", "standalone.ts"]) {
    it(`${entryPoint} runs its config through normalizeReplyLanguages`, () => {
      const source = stripComments(readFileSync(join(SRC, entryPoint), "utf-8"));
      expect(source).toContain("replyLanguages: normalizeReplyLanguages(config.replyLanguages)");
    });
  }

  it("hands the normalized config to the mount, not the raw one", () => {
    const plugin = stripComments(readFileSync(join(SRC, "plugin.ts"), "utf-8"));
    expect(plugin).toContain("config: resolvedConfig");
    const standalone = stripComments(readFileSync(join(SRC, "standalone.ts"), "utf-8"));
    expect(standalone).toContain("config: resolvedConfig");
  });
});

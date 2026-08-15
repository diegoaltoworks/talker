import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `exports` key must be backed by artifacts the build actually emits.
 *
 * `./twilio` shipped for several releases pointing at `dist/adapters/twilio.*`
 * while the bundler only ever built `src/index.ts`: the types resolved, so
 * nothing in this repo noticed, and `import "@diegoaltoworks/talker/twilio"`
 * threw ERR_MODULE_NOT_FOUND on the published package. A declared entry point
 * with no build step is invisible until a consumer hits it.
 *
 * This guard is the static half — it reads the manifest and proves each
 * declared path is produced. The dynamic half resolves every key from a packed
 * tarball (`bun run test:packaged`, run in CI).
 */

const ROOT = join(import.meta.dir, "..");

type Conditions = { types?: string; import?: string; require?: string };

function manifest(): {
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, Conditions>;
  scripts?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

/** `./dist/adapters/twilio.mjs` -> `src/adapters/twilio.ts` */
function sourceFor(distPath: string): string {
  return distPath
    .replace(/^\.\//, "")
    .replace(/^dist\//, "src/")
    .replace(/\.(mjs|js|d\.ts)$/, ".ts");
}

const pkg = manifest();
const exportEntries = Object.entries(pkg.exports ?? {});
const buildEsm = pkg.scripts?.["build:esm"] ?? "";
const buildCjs = pkg.scripts?.["build:cjs"] ?? "";

describe("package exports", () => {
  it("declares at least the root and the twilio subpath", () => {
    expect(exportEntries.map(([key]) => key).sort()).toEqual([".", "./twilio"]);
  });

  for (const [key, conditions] of exportEntries) {
    describe(key, () => {
      it("has a source module behind every condition", () => {
        for (const declared of [conditions.types, conditions.import, conditions.require]) {
          expect(declared).toBeString();
          const source = sourceFor(declared as string);
          expect({ key, source, exists: existsSync(join(ROOT, source)) }).toEqual({
            key,
            source,
            exists: true,
          });
        }
      });

      it("resolves all three conditions to the same module", () => {
        const sources = [conditions.types, conditions.import, conditions.require].map((declared) =>
          sourceFor(declared as string),
        );
        expect(new Set(sources).size).toBe(1);
      });

      it("is an entry point of both bundle builds", () => {
        const source = sourceFor(conditions.import as string);
        expect(buildEsm.split(/\s+/)).toContain(source);
        expect(buildCjs.split(/\s+/)).toContain(source);
      });
    });
  }

  it("emits .mjs for the ESM build and .js for the CJS build", () => {
    // The outdir/outbase pair is what maps src/adapters/twilio.ts onto the
    // dist/adapters/twilio.* paths the exports map declares.
    for (const script of [buildEsm, buildCjs]) {
      expect(script).toContain("--outdir=dist");
      expect(script).toContain("--outbase=src");
    }
    expect(buildEsm).toContain("--out-extension:.js=.mjs");
    expect(buildCjs).not.toContain("--out-extension");
  });

  it("keeps the legacy main/module/types fields pointing at the root entry", () => {
    for (const field of [pkg.main, pkg.module, pkg.types]) {
      expect(sourceFor(field as string)).toBe("src/index.ts");
    }
  });
});

describe("declaration build", () => {
  const buildTypes = pkg.scripts?.["build:types"] ?? "";

  it("runs against tsconfig.build.json", () => {
    expect(buildTypes).toContain("-p tsconfig.build.json");
  });

  const buildConfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.build.json"), "utf8")) as {
    extends?: string;
    compilerOptions?: { declarationMap?: boolean };
    exclude?: string[];
  };

  it("excludes test-only modules so their declarations never reach dist", () => {
    expect(buildConfig.extends).toBe("./tsconfig.json");
    // Fixtures are as much test scaffolding as the specs that import them.
    expect(buildConfig.exclude).toContain("src/**/*.test.ts");
    expect(buildConfig.exclude).toContain("src/**/*.fixtures.ts");
  });

  it("omits declaration maps, whose sources the package does not ship", () => {
    expect(buildConfig.compilerOptions?.declarationMap).toBe(false);
  });

  it("still typechecks tests via the base config", () => {
    const baseConfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")) as {
      include?: string[];
      exclude?: string[];
    };
    expect(baseConfig.include).toContain("src/**/*");
    expect(baseConfig.exclude ?? []).not.toContain("src/**/*.test.ts");
  });
});

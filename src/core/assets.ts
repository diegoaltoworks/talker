/**
 * Packaged asset resolution
 *
 * The package ships `language/` and `prompts/` alongside `dist/` (see the
 * `files` field). Both are looked up relative to the running module, which is
 * the one place where the source layout and the two bundle layouts disagree.
 */

import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { logger } from "./logger";

/**
 * Directory of the running module.
 *
 * `__dirname` is a CommonJS binding. It exists under Bun (where the tests run
 * against source) and in the CJS bundle, but not in an ESM bundle - reading it
 * there throws a ReferenceError. The ESM build substitutes `import.meta.dirname`
 * for it (`--define:__dirname=import.meta.dirname` in `build:esm`), so this
 * lookup is valid in every build. The `typeof` guard keeps a missing binding a
 * degradation to built-in defaults rather than a crash on the first webhook.
 */
function moduleDir(): string | undefined {
  return typeof __dirname === "string" ? __dirname : undefined;
}

/**
 * Locate a directory that ships with this package, by walking up from the
 * running module until it is found.
 *
 * Walking beats a list of fixed relative guesses because the depth differs per
 * build: `src/core/processing/` in source, `dist/` for the root bundles,
 * `dist/adapters/` for the subpath bundles. The first ancestor holding a
 * `package.json` is the ceiling - without it a host project's own `language/`
 * or `prompts/` directory could be picked up from outside the install.
 */
export function resolvePackagedDir(name: string): string | undefined {
  const start = moduleDir();
  if (!start) {
    logger.warn("module directory unavailable, using built-in defaults", { asset: name });
    return undefined;
  }
  return findPackagedDirFrom(start, name);
}

/** The walk itself, with an explicit starting point so it can be tested. */
export function findPackagedDirFrom(start: string, name: string): string | undefined {
  let dir = start;
  const { root } = parse(dir);
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dir === root || existsSync(join(dir, "package.json"))) {
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

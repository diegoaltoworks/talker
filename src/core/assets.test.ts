import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findPackagedDirFrom, resolvePackagedDir } from "./assets";

const REPO_ROOT = resolve(import.meta.dir, "../..");

describe("resolvePackagedDir", () => {
  test("finds language/ from src/core/", () => {
    expect(resolvePackagedDir("language")).toBe(join(REPO_ROOT, "language"));
  });

  test("finds prompts/ by walking up past intermediate directories", () => {
    expect(resolvePackagedDir("prompts")).toBe(join(REPO_ROOT, "prompts"));
  });

  test("the resolved directories hold the assets that ship with the package", () => {
    const language = resolvePackagedDir("language") as string;
    const prompts = resolvePackagedDir("prompts") as string;
    expect(existsSync(join(language, "en.json"))).toBe(true);
    expect(existsSync(join(prompts, "incoming.md"))).toBe(true);
    expect(existsSync(join(prompts, "outgoing.md"))).toBe(true);
  });

  test("returns undefined for a directory the package does not ship", () => {
    expect(resolvePackagedDir("no-such-asset-dir")).toBeUndefined();
  });
});

describe("findPackagedDirFrom", () => {
  // host/                  <- an asset directory the package must never reach
  //   host/language/
  //   host/pkg/            <- the installed package (package.json marks the root)
  //     host/pkg/language/
  //     host/pkg/dist/adapters/
  const host = mkdtempSync(join(tmpdir(), "talker-assets-"));
  const pkg = join(host, "pkg");
  const nested = join(pkg, "dist", "adapters");
  mkdirSync(join(host, "language"), { recursive: true });
  mkdirSync(join(pkg, "language"), { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{}");

  afterAll(() => rmSync(host, { recursive: true, force: true }));

  test("resolves from any bundle depth inside the package", () => {
    expect(findPackagedDirFrom(nested, "language")).toBe(join(pkg, "language"));
    expect(findPackagedDirFrom(join(pkg, "dist"), "language")).toBe(join(pkg, "language"));
    expect(findPackagedDirFrom(pkg, "language")).toBe(join(pkg, "language"));
  });

  test("stops at the package root rather than reaching into the host project", () => {
    rmSync(join(pkg, "language"), { recursive: true });
    expect(findPackagedDirFrom(nested, "language")).toBeUndefined();
  });
});

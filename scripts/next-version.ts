/**
 * Derives the next release version from conventional-commit messages, so a
 * chore/docs/fix merge ships a patch and only a feat (or a breaking change)
 * ships a minor. The publish workflow used to bump the minor on every merge
 * to main, which is why 0.x climbed a minor per typo fix and the number said
 * nothing about what changed.
 *
 * A `!` breaking-change marker (`feat!:`, `fix(api)!:`) and a `BREAKING
 * CHANGE:` (or `BREAKING-CHANGE:`) footer in the commit body both ship a
 * major - but only once the package is past 1.0. Before 1.0 they still reach
 * minor and no further: semver leaves 0.x compatibility undefined, so minor
 * is already the strongest signal the range has, and bumping to 1.0.0 is a
 * decision about the API being frozen, not something a commit subject gets
 * to make on its own.
 */

export type Bump = "major" | "minor" | "patch";

const CONVENTIONAL_TYPE = /^([a-z]+)(\([^)]+\))?(!)?:/;
const BREAKING_CHANGE_FOOTER = /^BREAKING[ -]CHANGE:/m;

/** True when the version's major component is 1 or higher, so a major tier exists to reach. */
function isPastOne(version: string): boolean {
  const major = Number(version.split(".")[0]);
  return Number.isInteger(major) && major >= 1;
}

function isBreaking(message: string): boolean {
  const subject = message.split("\n", 1)[0] ?? "";
  return CONVENTIONAL_TYPE.exec(subject)?.[3] === "!" || BREAKING_CHANGE_FOOTER.test(message);
}

/**
 * Highest bump implied by a set of full commit messages (subject plus body),
 * given the version it would apply to: a `BREAKING CHANGE:` footer counts the
 * same as a `feat!` subject even when the subject itself is `fix:` or
 * `chore:`, and both collapse to minor below 1.0.0.
 */
export function bumpFromCommitMessages(messages: string[], currentVersion: string): Bump {
  if (messages.some(isBreaking)) return isPastOne(currentVersion) ? "major" : "minor";
  const isFeat = messages.some(
    (message) => CONVENTIONAL_TYPE.exec(message.split("\n", 1)[0] ?? "")?.[1] === "feat",
  );
  return isFeat ? "minor" : "patch";
}

/** Applies a bump to a `major.minor.patch` version string. */
export function applyBump(version: string, bump: Bump): string {
  const parts = version.split(".").map(Number);
  const [major, minor, patch] = parts;
  if (parts.length !== 3 || [major, minor, patch].some((n) => !Number.isInteger(n))) {
    throw new Error(`not a major.minor.patch version: ${version}`);
  }
  if (bump === "major") return `${major + 1}.0.0`;
  return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Null byte: the record separator between full commit messages on stdin, since a message body can itself contain newlines. */
const MESSAGE_SEPARATOR = "\x00";

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "bump") {
    const [currentVersion] = rest;
    if (!currentVersion) {
      throw new Error(
        "usage: next-version.ts bump <current-version> < null-separated commit messages on stdin",
      );
    }
    const messages = (await readStdin())
      .split(MESSAGE_SEPARATOR)
      .map((message) => message.trim())
      .filter(Boolean);
    process.stdout.write(bumpFromCommitMessages(messages, currentVersion));
    return;
  }
  if (mode === "apply") {
    const [version, bump] = rest;
    if (!version || (bump !== "major" && bump !== "minor" && bump !== "patch")) {
      throw new Error("usage: next-version.ts apply <major.minor.patch> <major|minor|patch>");
    }
    process.stdout.write(applyBump(version, bump));
    return;
  }
  throw new Error(
    "usage: next-version.ts bump <current-version> <null-separated commit messages on stdin> | apply <version> <bump>",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

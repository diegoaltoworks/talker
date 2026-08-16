/**
 * Derives the next release version from conventional-commit messages, so a
 * chore/docs/fix merge ships a patch and only a feat (or a breaking change)
 * ships a minor. The publish workflow used to bump the minor on every merge
 * to main, which is why 0.x climbed a minor per typo fix and the number said
 * nothing about what changed.
 *
 * A `!` breaking-change marker (`feat!:`, `fix!:`) and a `BREAKING CHANGE:`
 * (or `BREAKING-CHANGE:`) footer in the commit body both still only reach
 * minor here - a distinct major-bump tier is reserved for when that
 * matters, post-1.0.
 */

export type Bump = "minor" | "patch";

const CONVENTIONAL_TYPE = /^([a-z]+)(\([^)]+\))?!?:/;
const BREAKING_CHANGE_FOOTER = /^BREAKING[ -]CHANGE:/m;

/**
 * Highest bump implied by a set of full commit messages (subject plus body),
 * so a `BREAKING CHANGE:` footer counts the same as a `feat` subject even
 * when the subject itself is `fix:` or `chore:`.
 */
export function bumpFromCommitMessages(messages: string[]): Bump {
  const bumps = messages.some((message) => {
    const subject = message.split("\n", 1)[0] ?? "";
    return CONVENTIONAL_TYPE.exec(subject)?.[1] === "feat" || BREAKING_CHANGE_FOOTER.test(message);
  });
  return bumps ? "minor" : "patch";
}

/** Applies a bump to a `major.minor.patch` version string. */
export function applyBump(version: string, bump: Bump): string {
  const parts = version.split(".").map(Number);
  const [major, minor, patch] = parts;
  if (parts.length !== 3 || [major, minor, patch].some((n) => !Number.isInteger(n))) {
    throw new Error(`not a major.minor.patch version: ${version}`);
  }
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
    const messages = (await readStdin())
      .split(MESSAGE_SEPARATOR)
      .map((message) => message.trim())
      .filter(Boolean);
    process.stdout.write(bumpFromCommitMessages(messages));
    return;
  }
  if (mode === "apply") {
    const [version, bump] = rest;
    if (!version || (bump !== "minor" && bump !== "patch")) {
      throw new Error("usage: next-version.ts apply <major.minor.patch> <minor|patch>");
    }
    process.stdout.write(applyBump(version, bump));
    return;
  }
  throw new Error(
    "usage: next-version.ts bump <null-separated commit messages on stdin> | apply <version> <bump>",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

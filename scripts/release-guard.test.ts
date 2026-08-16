import { describe, expect, test } from "bun:test";
import {
  blockingCommits,
  DEPENDABOT_AUTHOR,
  describeCommit,
  exemptCommits,
  isManifestOnly,
  parseGitLog,
  type UnreleasedCommit,
} from "./release-guard";

/** The separators GIT_LOG_FORMAT asks git for: NUL between commits, US between fields. */
const RECORD = "\u0000";
const FIELD = "\u001f";

/** Build the `git log --format=… --name-only` output for a set of commits. */
function gitLog(...commits: UnreleasedCommit[]): string {
  return commits
    .map(
      ({ sha, author, subject, files }) =>
        `${RECORD}${sha}${FIELD}${author}${FIELD}${subject}\n\n${files.join("\n")}\n`,
    )
    .join("");
}

function commit(overrides: Partial<UnreleasedCommit> = {}): UnreleasedCommit {
  return {
    sha: "0123456789abcdef0123456789abcdef01234567",
    author: "Some Human",
    subject: "feat: something",
    files: ["src/routes/voice.ts"],
    ...overrides,
  };
}

/** The common case: a grouped dev-dependency bump, manifest and lockfile only. */
const MANIFEST_ONLY_BUMP = commit({
  sha: "c045924e7e6ffc9d448790193623f70ff0411b98",
  author: DEPENDABOT_AUTHOR,
  subject: "chore(deps): bump the development-dependencies group with 3 updates",
  files: ["package.json", "bun.lock"],
});

describe("isManifestOnly", () => {
  test("accepts manifests and lockfiles, wherever they sit in the tree", () => {
    expect(isManifestOnly(["package.json", "bun.lock", "test/fixtures/package.json"])).toBe(true);
  });

  test("rejects a bump that also edits something that runs", () => {
    expect(isManifestOnly(["package.json", ".github/workflows/ci.yml"])).toBe(false);
    expect(isManifestOnly(["Dockerfile"])).toBe(false);
    expect(isManifestOnly(["src/adapters/twilio.ts"])).toBe(false);
  });

  test("treats an unreadable file list as unsafe, not as empty", () => {
    expect(isManifestOnly([])).toBe(false);
  });
});

describe("blockingCommits", () => {
  test("a manifest-only bump rides along instead of wedging the release train", () => {
    const range = [commit({ subject: "feat: ship the fix" }), MANIFEST_ONLY_BUMP];

    expect(blockingCommits(range)).toEqual([]);
    expect(exemptCommits(range)).toEqual([MANIFEST_ONLY_BUMP]);
  });

  test("a dependabot bump that edits a workflow still needs a human", () => {
    const actionBump = commit({
      author: DEPENDABOT_AUTHOR,
      subject: "chore(deps): bump actions/checkout",
      files: [".github/workflows/npm-publish.yml"],
    });

    expect(blockingCommits([commit(), actionBump])).toEqual([actionBump]);
  });

  test("a dependabot bump that edits source still needs a human", () => {
    const sourceBump = commit({
      author: DEPENDABOT_AUTHOR,
      subject: "chore(deps): bump hono",
      files: ["package.json", "src/plugin.ts"],
    });

    expect(blockingCommits([sourceBump])).toEqual([sourceBump]);
    expect(exemptCommits([sourceBump])).toEqual([]);
  });

  test("only dependabot's commits are ever considered", () => {
    const humanTouchingTheManifest = commit({ files: ["package.json"] });
    const humanTouchingAnything = commit({ files: ["Dockerfile", "src/index.ts"] });

    expect(blockingCommits([humanTouchingTheManifest, humanTouchingAnything])).toEqual([]);
    expect(exemptCommits([humanTouchingTheManifest])).toEqual([]);
  });

  test("a range of ordinary human commits never blocks", () => {
    expect(blockingCommits([commit(), commit(), commit()])).toEqual([]);
  });

  test("an unsquashed dependabot merge blocks, since its changes cannot be read", () => {
    const merge = commit({ author: DEPENDABOT_AUTHOR, files: [] });

    expect(blockingCommits([merge])).toEqual([merge]);
  });
});

describe("parseGitLog", () => {
  test("reads sha, author, subject and files for each commit", () => {
    const parsed = parseGitLog(gitLog(MANIFEST_ONLY_BUMP, commit()));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(MANIFEST_ONLY_BUMP);
    expect(parsed[1]?.author).toBe("Some Human");
  });

  test("survives a subject containing the characters a naive parser splits on", () => {
    const tricky = commit({ subject: "fix: handle a | pipe, a : colon and a #hash" });

    expect(parseGitLog(gitLog(tricky))[0]?.subject).toBe(tricky.subject);
  });

  test("keeps a merge commit, whose file list git prints as empty", () => {
    const parsed = parseGitLog(gitLog(commit({ author: DEPENDABOT_AUTHOR, files: [] })));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.files).toEqual([]);
  });

  test("an empty range is no commits, not one blank commit", () => {
    expect(parseGitLog("")).toEqual([]);
    expect(parseGitLog("\n")).toEqual([]);
  });
});

describe("describeCommit", () => {
  test("names the commit and what it touched", () => {
    expect(describeCommit(MANIFEST_ONLY_BUMP)).toContain("c045924e");
    expect(describeCommit(MANIFEST_ONLY_BUMP)).toContain("package.json");
  });

  test("says so when the file list could not be read", () => {
    expect(describeCommit(commit({ files: [] }))).toContain("unreadable");
  });
});

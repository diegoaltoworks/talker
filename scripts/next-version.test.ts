import { describe, expect, test } from "bun:test";
import { applyBump, bumpFromCommitMessages } from "./next-version";

describe("bumpFromCommitMessages", () => {
  test("fix, chore, and docs subjects all bump patch", () => {
    expect(bumpFromCommitMessages(["fix: resolve bug"])).toBe("patch");
    expect(bumpFromCommitMessages(["chore: maintenance"])).toBe("patch");
    expect(bumpFromCommitMessages(["docs: update readme"])).toBe("patch");
  });

  test("a feat subject bumps minor", () => {
    expect(bumpFromCommitMessages(["feat: add new feature"])).toBe("minor");
  });

  test("a scoped feat subject still counts", () => {
    expect(bumpFromCommitMessages(["feat(twilio): add delivery status route"])).toBe("minor");
  });

  test("one feat among several fixes still bumps minor", () => {
    expect(bumpFromCommitMessages(["fix: a", "chore: b", "feat: c", "docs: d"])).toBe("minor");
  });

  test("a breaking-change marker still only reaches minor, not a separate major tier", () => {
    expect(bumpFromCommitMessages(["feat!: drop the old config shape"])).toBe("minor");
    expect(bumpFromCommitMessages(["feat(voice)!: change the answer signature"])).toBe("minor");
  });

  test("a subject whose type merely starts with feat is not a feat", () => {
    expect(bumpFromCommitMessages(["feature: add something"])).toBe("patch");
  });

  test("an unconventional subject is treated as patch, not thrown on", () => {
    expect(bumpFromCommitMessages(["Merge pull request #85"])).toBe("patch");
  });

  test("a BREAKING CHANGE footer bumps minor even under a fix subject", () => {
    const message = "fix: drop the deprecated field\n\nBREAKING CHANGE: removes the old shape";
    expect(bumpFromCommitMessages([message])).toBe("minor");
  });

  test("the hyphenated BREAKING-CHANGE footer synonym also counts", () => {
    const message = "fix: drop the deprecated field\n\nBREAKING-CHANGE: removes the old shape";
    expect(bumpFromCommitMessages([message])).toBe("minor");
  });

  test("a BREAKING CHANGE footer among several plain commits still bumps minor", () => {
    const messages = [
      "chore: bump a dependency",
      "fix: drop the deprecated field\n\nBREAKING CHANGE: removes the old shape",
      "docs: update readme",
    ];
    expect(bumpFromCommitMessages(messages)).toBe("minor");
  });

  test("the phrase 'breaking change' outside a footer line does not count", () => {
    const message = "fix: mention a breaking change in passing, not as a footer";
    expect(bumpFromCommitMessages([message])).toBe("patch");
  });

  test("no commits is patch", () => {
    expect(bumpFromCommitMessages([])).toBe("patch");
  });
});

describe("applyBump", () => {
  test("patch increments the patch component", () => {
    expect(applyBump("0.44.0", "patch")).toBe("0.44.1");
  });

  test("minor increments minor and resets patch", () => {
    expect(applyBump("0.44.3", "minor")).toBe("0.45.0");
  });

  test("rejects a malformed version", () => {
    expect(() => applyBump("0.44", "patch")).toThrow();
    expect(() => applyBump("not.a.version", "patch")).toThrow();
  });
});

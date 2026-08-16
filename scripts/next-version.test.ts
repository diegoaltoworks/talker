import { describe, expect, test } from "bun:test";
import { applyBump, bumpFromCommitMessages } from "./next-version";

/** The 0.x version the repo actually sits on while these tiers are exercised. */
const PRE_ONE = "0.45.0";
/** A post-1.0 version, where the major tier becomes reachable. */
const PAST_ONE = "1.4.2";

describe("bumpFromCommitMessages", () => {
  test("fix, chore, and docs subjects all bump patch", () => {
    expect(bumpFromCommitMessages(["fix: resolve bug"], PRE_ONE)).toBe("patch");
    expect(bumpFromCommitMessages(["chore: maintenance"], PRE_ONE)).toBe("patch");
    expect(bumpFromCommitMessages(["docs: update readme"], PRE_ONE)).toBe("patch");
  });

  test("a feat subject bumps minor", () => {
    expect(bumpFromCommitMessages(["feat: add new feature"], PRE_ONE)).toBe("minor");
  });

  test("a scoped feat subject still counts", () => {
    expect(bumpFromCommitMessages(["feat(twilio): add delivery status route"], PRE_ONE)).toBe(
      "minor",
    );
  });

  test("one feat among several fixes still bumps minor", () => {
    expect(bumpFromCommitMessages(["fix: a", "chore: b", "feat: c", "docs: d"], PRE_ONE)).toBe(
      "minor",
    );
  });

  test("a subject whose type merely starts with feat is not a feat", () => {
    expect(bumpFromCommitMessages(["feature: add something"], PRE_ONE)).toBe("patch");
  });

  test("an unconventional subject is treated as patch, not thrown on", () => {
    expect(bumpFromCommitMessages(["Merge pull request #85"], PRE_ONE)).toBe("patch");
  });

  test("the phrase 'breaking change' outside a footer line does not count", () => {
    const message = "fix: mention a breaking change in passing, not as a footer";
    expect(bumpFromCommitMessages([message], PAST_ONE)).toBe("patch");
  });

  test("no commits is patch at either tier", () => {
    expect(bumpFromCommitMessages([], PRE_ONE)).toBe("patch");
    expect(bumpFromCommitMessages([], PAST_ONE)).toBe("patch");
  });

  describe("below 1.0.0 a breaking change reaches minor and no further", () => {
    test("a `!` marker only reaches minor", () => {
      expect(bumpFromCommitMessages(["feat!: drop the old config shape"], PRE_ONE)).toBe("minor");
      expect(bumpFromCommitMessages(["feat(voice)!: change the answer signature"], PRE_ONE)).toBe(
        "minor",
      );
    });

    test("a BREAKING CHANGE footer only reaches minor, even under a fix subject", () => {
      const message = "fix: drop the deprecated field\n\nBREAKING CHANGE: removes the old shape";
      expect(bumpFromCommitMessages([message], PRE_ONE)).toBe("minor");
    });

    test("the hyphenated BREAKING-CHANGE footer synonym also counts", () => {
      const message = "fix: drop the deprecated field\n\nBREAKING-CHANGE: removes the old shape";
      expect(bumpFromCommitMessages([message], PRE_ONE)).toBe("minor");
    });
  });

  describe("at 1.0.0 and above a breaking change reaches major", () => {
    test("a `!` marker bumps major", () => {
      expect(bumpFromCommitMessages(["feat!: drop the old config shape"], PAST_ONE)).toBe("major");
      expect(bumpFromCommitMessages(["fix(api)!: rename the callback"], PAST_ONE)).toBe("major");
    });

    test("a BREAKING CHANGE footer bumps major even under a chore subject", () => {
      const message = "chore: tidy up\n\nBREAKING CHANGE: removes the old shape";
      expect(bumpFromCommitMessages([message], PAST_ONE)).toBe("major");
    });

    test("a breaking commit among several plain ones still bumps major", () => {
      const messages = [
        "chore: bump a dependency",
        "fix: drop the deprecated field\n\nBREAKING CHANGE: removes the old shape",
        "docs: update readme",
      ];
      expect(bumpFromCommitMessages(messages, PAST_ONE)).toBe("major");
    });

    test("1.0.0 itself is already past the boundary", () => {
      expect(bumpFromCommitMessages(["feat!: freeze the API"], "1.0.0")).toBe("major");
    });

    test("without a breaking marker a feat still ships a minor", () => {
      expect(bumpFromCommitMessages(["feat: add new feature"], PAST_ONE)).toBe("minor");
    });
  });

  test("a malformed current version is treated as pre-1.0, never as major", () => {
    expect(bumpFromCommitMessages(["feat!: break things"], "not-a-version")).toBe("minor");
  });
});

describe("applyBump", () => {
  test("patch increments the patch component", () => {
    expect(applyBump("0.44.0", "patch")).toBe("0.44.1");
  });

  test("minor increments minor and resets patch", () => {
    expect(applyBump("0.44.3", "minor")).toBe("0.45.0");
  });

  test("major increments major and resets minor and patch", () => {
    expect(applyBump("1.4.2", "major")).toBe("2.0.0");
    expect(applyBump("0.45.0", "major")).toBe("1.0.0");
  });

  test("rejects a malformed version", () => {
    expect(() => applyBump("0.44", "patch")).toThrow();
    expect(() => applyBump("not.a.version", "patch")).toThrow();
  });
});

describe("end to end: the tier the publish workflow would pick", () => {
  /** Mirrors the workflow's two steps: derive a bump from the range, then apply it to the base version. */
  function release(base: string, messages: string[]): string {
    return applyBump(base, bumpFromCommitMessages(messages, base));
  }

  test("a breaking change below 1.0 ships a minor, not 1.0.0", () => {
    expect(release("0.45.0", ["feat!: drop the old config shape"])).toBe("0.46.0");
  });

  test("the same change past 1.0 ships a major", () => {
    expect(release("1.0.0", ["feat!: drop the old config shape"])).toBe("2.0.0");
  });

  test("a plain feat past 1.0 stays on the minor tier", () => {
    expect(release("1.0.0", ["feat: add a route"])).toBe("1.1.0");
  });
});

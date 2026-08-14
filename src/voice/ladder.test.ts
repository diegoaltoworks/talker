import { describe, expect, it } from "bun:test";
import { runVoiceReply, type VoiceReplyDeps, type VoiceReplyPhrases } from "./ladder";
import type { VoiceNote } from "./synthesize";

const phrases: VoiceReplyPhrases = {
  overCapPerNumber: "per-number cap copy",
  overCapGlobal: "global cap copy",
  limitUnavailable: "limit unavailable copy",
  unintelligible: "unintelligible copy",
  answerFailed: "answer failed copy",
};

const note: VoiceNote = { bytes: new Uint8Array([1, 2, 3]), seconds: 2 };

/** A ladder with every step succeeding — individual tests override one step. */
function baseDeps(overrides: Partial<VoiceReplyDeps> = {}): {
  deps: VoiceReplyDeps;
  sent: { voice: VoiceNote[]; text: string[] };
} {
  const sent = { voice: [] as VoiceNote[], text: [] as string[] };
  const deps: VoiceReplyDeps = {
    reserve: async () => ({ allowed: true, reason: null }),
    download: async () => new Uint8Array([9, 9, 9]),
    transcribe: async () => "what time is checkout",
    answer: async () => "checkout is at 11am",
    synthesize: async () => note,
    sendVoice: async (n) => {
      sent.voice.push(n);
      return true;
    },
    sendText: async (text) => {
      sent.text.push(text);
    },
    phrases,
    ...overrides,
  };
  return { deps, sent };
}

describe("runVoiceReply", () => {
  it("delivers voice when every step succeeds", async () => {
    const { deps, sent } = baseDeps();

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("voice");
    expect(sent.voice).toEqual([note]);
    expect(sent.text).toEqual([]);
  });

  it("falls back to text with the actual reply when sendVoice returns false", async () => {
    const { deps, sent } = baseDeps({ sendVoice: async () => false });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("text");
    expect(sent.text).toEqual(["checkout is at 11am"]);
  });

  it("falls back to text when sendVoice throws", async () => {
    const { deps, sent } = baseDeps({
      sendVoice: async () => {
        throw new Error("socket closed");
      },
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("text");
    expect(sent.text).toEqual(["checkout is at 11am"]);
  });

  it("falls back to text with the actual reply when synthesize returns null", async () => {
    const { deps, sent } = baseDeps({ synthesize: async () => null });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("text");
    expect(sent.text).toEqual(["checkout is at 11am"]);
    expect(sent.voice).toEqual([]);
  });

  it("falls back to text when synthesize throws", async () => {
    const { deps, sent } = baseDeps({
      synthesize: async () => {
        throw new Error("upstream 503");
      },
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("text");
    expect(sent.text).toEqual(["checkout is at 11am"]);
  });

  it("bails to the per-number cap phrase when reserve reports per-number denial", async () => {
    const { deps, sent } = baseDeps({
      reserve: async () => ({ allowed: false, reason: "per-number" }),
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("over-cap");
    expect(sent.text).toEqual([phrases.overCapPerNumber]);
  });

  it("bails to the global cap phrase when reserve reports global denial", async () => {
    const { deps, sent } = baseDeps({
      reserve: async () => ({ allowed: false, reason: "global" }),
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("over-cap");
    expect(sent.text).toEqual([phrases.overCapGlobal]);
  });

  it("fails closed to text when reserve throws", async () => {
    const { deps, sent } = baseDeps({
      reserve: async () => {
        throw new Error("store down");
      },
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("limit-error");
    expect(sent.text).toEqual([phrases.limitUnavailable]);
  });

  it("bails when download throws", async () => {
    const { deps, sent } = baseDeps({
      download: async () => {
        throw new Error("media fetch failed");
      },
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("no-audio");
    expect(sent.text).toEqual([phrases.unintelligible]);
  });

  it("bails when download returns empty bytes", async () => {
    const { deps, sent } = baseDeps({ download: async () => new Uint8Array() });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("no-audio");
    expect(sent.text).toEqual([phrases.unintelligible]);
  });

  it("bails when transcribe returns null", async () => {
    const { deps, sent } = baseDeps({ transcribe: async () => null });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("transcribe-failed");
    expect(sent.text).toEqual([phrases.unintelligible]);
  });

  it("bails when transcribe throws, despite its null-not-throw contract", async () => {
    const { deps, sent } = baseDeps({
      transcribe: async () => {
        throw new Error("upstream 503");
      },
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("transcribe-failed");
    expect(sent.text).toEqual([phrases.unintelligible]);
  });

  it("bails when answer throws", async () => {
    const { deps, sent } = baseDeps({
      answer: async () => {
        throw new Error("pipeline error");
      },
    });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("answer-failed");
    expect(sent.text).toEqual([phrases.answerFailed]);
  });

  it("bails when answer returns an empty or whitespace-only reply", async () => {
    const { deps, sent } = baseDeps({ answer: async () => "   " });

    const outcome = await runVoiceReply(deps);

    expect(outcome).toBe("answer-failed");
    expect(sent.text).toEqual([phrases.answerFailed]);
  });

  it("surfaces a text-send failure to the caller instead of swallowing it", async () => {
    const { deps } = baseDeps({
      sendVoice: async () => false,
      sendText: async () => {
        throw new Error("carrier rejected the message");
      },
    });

    await expect(runVoiceReply(deps)).rejects.toThrow("carrier rejected the message");
  });

  it("surfaces a text-send failure even on a phrase-fallback branch", async () => {
    const { deps } = baseDeps({
      reserve: async () => ({ allowed: false, reason: "global" }),
      sendText: async () => {
        throw new Error("carrier rejected the message");
      },
    });

    await expect(runVoiceReply(deps)).rejects.toThrow("carrier rejected the message");
  });

  it("never calls download/transcribe/answer/synthesize once a fallback fires earlier in the ladder", async () => {
    const calls: string[] = [];
    const { deps } = baseDeps({
      reserve: async () => ({ allowed: false, reason: "per-number" }),
      download: async () => {
        calls.push("download");
        return new Uint8Array([9, 9, 9]);
      },
      transcribe: async () => {
        calls.push("transcribe");
        return "text";
      },
      answer: async () => {
        calls.push("answer");
        return "reply";
      },
      synthesize: async () => {
        calls.push("synthesize");
        return note;
      },
    });

    await runVoiceReply(deps);

    expect(calls).toEqual([]);
  });
});

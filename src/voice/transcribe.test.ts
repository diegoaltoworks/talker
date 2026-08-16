import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { oggOpusStream } from "./ogg.fixtures";
import { createTranscriber, DEFAULT_TRANSCRIPT_MAX_CHARS } from "./transcribe";

type TranscriptionCall = { file?: unknown; model?: string };

/** Stand-in for the OpenAI client — no paid API is reached from tests. */
function mockClient(respond: () => Promise<{ text?: string }>) {
  const calls: TranscriptionCall[] = [];
  const client = {
    audio: {
      transcriptions: {
        create: async (params: TranscriptionCall) => {
          calls.push(params);
          return await respond();
        },
      },
    },
  } as unknown as OpenAI;
  return { client: () => client, calls };
}

const audio = oggOpusStream(1, 48000 * 2);

describe("createTranscriber", () => {
  it("returns the trimmed transcript", async () => {
    const { client } = mockClient(async () => ({ text: "  book me a table  " }));
    const transcribe = createTranscriber({ client, enabled: () => true });

    expect(await transcribe(audio)).toBe("book me a table");
  });

  it("returns null when disabled, without calling the API", async () => {
    const { client, calls } = mockClient(async () => ({ text: "hello" }));
    const transcribe = createTranscriber({ client, enabled: () => false });

    expect(await transcribe(audio)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for empty audio, without calling the API", async () => {
    const { client, calls } = mockClient(async () => ({ text: "hello" }));
    const transcribe = createTranscriber({ client, enabled: () => true });

    expect(await transcribe(new Uint8Array(0))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for an empty or whitespace-only transcript", async () => {
    const { client } = mockClient(async () => ({ text: "   " }));
    const transcribe = createTranscriber({ client, enabled: () => true });

    expect(await transcribe(audio)).toBeNull();
  });

  it("returns null when the response carries no text field", async () => {
    const { client } = mockClient(async () => ({}));
    const transcribe = createTranscriber({ client, enabled: () => true });

    expect(await transcribe(audio)).toBeNull();
  });

  // The null-not-throw contract is what makes the caller's text fallback
  // reachable, so every host-supplied callback is covered, not just the API.
  describe("never throws", () => {
    it("returns null instead of throwing when the API fails", async () => {
      const { client } = mockClient(async () => {
        throw new Error("upstream 500");
      });
      const transcribe = createTranscriber({ client, enabled: () => true });

      expect(await transcribe(audio)).toBeNull();
    });

    it("returns null when the enabled gate itself throws", async () => {
      const { client } = mockClient(async () => ({ text: "hello" }));
      const transcribe = createTranscriber({
        client,
        enabled: () => {
          throw new Error("config not loaded");
        },
      });

      expect(await transcribe(audio)).toBeNull();
    });

    it("returns null when the client factory throws", async () => {
      // The likeliest real failure: a lazy `new OpenAI()` with no API key, or
      // with the optional peer absent.
      const transcribe = createTranscriber({
        client: () => {
          throw new Error("missing OPENAI_API_KEY");
        },
        enabled: () => true,
      });

      expect(await transcribe(audio)).toBeNull();
    });
  });

  it("clamps the transcript to maxChars", async () => {
    const { client } = mockClient(async () => ({ text: "abcdefghij" }));
    const transcribe = createTranscriber({ client, enabled: () => true, maxChars: 4 });

    expect(await transcribe(audio)).toBe("abcd");
  });

  it("does not split a surrogate pair when clamping to maxChars", async () => {
    // "ab" + an astral emoji (a surrogate pair, length 2) - a naive
    // substring(0, 3) would keep only the lone high surrogate.
    const { client } = mockClient(async () => ({ text: "ab\u{1F600}cd" }));
    const transcribe = createTranscriber({ client, enabled: () => true, maxChars: 3 });

    const result = await transcribe(audio);
    expect(result).toBe("ab");
    const last = result?.charCodeAt((result?.length ?? 1) - 1) ?? 0;
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("defaults the clamp to DEFAULT_TRANSCRIPT_MAX_CHARS", async () => {
    const { client } = mockClient(async () => ({
      text: "x".repeat(DEFAULT_TRANSCRIPT_MAX_CHARS + 50),
    }));
    const transcribe = createTranscriber({ client, enabled: () => true });

    expect(await transcribe(audio)).toHaveLength(DEFAULT_TRANSCRIPT_MAX_CHARS);
  });

  it("uploads the audio as an ogg file the SDK can send as-is", async () => {
    const { client, calls } = mockClient(async () => ({ text: "hello" }));
    const transcribe = createTranscriber({ client, enabled: () => true });

    await transcribe(audio);

    const file = calls[0]?.file as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("audio/ogg");
    expect(file.size).toBe(audio.length);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(audio));
  });

  it("passes the model override through", async () => {
    const { client, calls } = mockClient(async () => ({ text: "hello" }));
    const transcribe = createTranscriber({ client, enabled: () => true, model: "custom-stt" });

    await transcribe(audio);

    expect(calls[0]?.model).toBe("custom-stt");
  });

  it("re-reads the enabled gate on every call", async () => {
    const { client } = mockClient(async () => ({ text: "hello" }));
    let on = false;
    const transcribe = createTranscriber({ client, enabled: () => on });

    expect(await transcribe(audio)).toBeNull();
    on = true;
    expect(await transcribe(audio)).toBe("hello");
  });
});

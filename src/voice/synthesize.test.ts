import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { oggOpusStream } from "./ogg.fixtures";
import { createSynthesizer, DEFAULT_MAX_VOICE_TEXT_CHARS } from "./synthesize";

type SpeechCall = Record<string, unknown>;

/**
 * A stand-in for the OpenAI client. Paid APIs are never called from tests; the
 * recorded calls are what the assertions inspect.
 */
function mockClient(respond: () => Promise<Uint8Array>) {
  const calls: SpeechCall[] = [];
  const client = {
    audio: {
      speech: {
        create: async (params: SpeechCall) => {
          calls.push(params);
          const bytes = await respond();
          return { arrayBuffer: async () => bytes.slice().buffer };
        },
      },
    },
  } as unknown as OpenAI;
  return { client: () => client, calls };
}

function monoClient(seconds = 3) {
  return mockClient(async () => oggOpusStream(1, 48000 * seconds));
}

describe("createSynthesizer", () => {
  it("returns mono bytes and the container duration", async () => {
    const { client } = monoClient(4);
    const synthesize = createSynthesizer({ client, enabled: () => true });

    const note = await synthesize("Your booking is confirmed.");

    expect(note).not.toBeNull();
    expect(note?.seconds).toBe(4);
    expect(note?.bytes.length).toBeGreaterThan(0);
  });

  it("returns null when disabled, without calling the API", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({ client, enabled: () => false });

    expect(await synthesize("hello")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for empty or whitespace-only text, without calling the API", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({ client, enabled: () => true });

    expect(await synthesize("")).toBeNull();
    expect(await synthesize("   \n\t ")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("refuses non-mono audio rather than delivering a broken bubble", async () => {
    const { client } = mockClient(async () => oggOpusStream(2, 48000));
    const synthesize = createSynthesizer({ client, enabled: () => true });

    expect(await synthesize("hello")).toBeNull();
  });

  it("refuses output that is not parseable Ogg/Opus", async () => {
    const { client } = mockClient(async () => new TextEncoder().encode("not audio at all"));
    const synthesize = createSynthesizer({ client, enabled: () => true });

    expect(await synthesize("hello")).toBeNull();
  });

  it("returns null instead of throwing when the API fails", async () => {
    const { client } = mockClient(async () => {
      throw new Error("upstream 503");
    });
    const synthesize = createSynthesizer({ client, enabled: () => true });

    expect(await synthesize("hello")).toBeNull();
  });

  it("clamps input to maxChars and trims before sending", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({ client, enabled: () => true, maxChars: 5 });

    await synthesize("  abcdefghij  ");

    expect(calls[0]?.input).toBe("abcde");
  });

  it("defaults the clamp to DEFAULT_MAX_VOICE_TEXT_CHARS", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({ client, enabled: () => true });

    await synthesize("x".repeat(DEFAULT_MAX_VOICE_TEXT_CHARS + 100));

    expect(String(calls[0]?.input)).toHaveLength(DEFAULT_MAX_VOICE_TEXT_CHARS);
  });

  it("asks for opus so the container carries the duration", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({ client, enabled: () => true });

    await synthesize("hello");

    expect(calls[0]?.response_format).toBe("opus");
    expect(calls[0]?.speed).toBe(1);
  });

  it("resolves the voice through the host's voiceFor mapping", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({
      client,
      enabled: () => true,
      voiceFor: (personaId) => (personaId === "concierge" ? "sage" : "alloy"),
    });

    await synthesize("hello", { personaId: "concierge" });
    await synthesize("hello", { personaId: "other" });

    expect(calls[0]?.voice).toBe("sage");
    expect(calls[1]?.voice).toBe("alloy");
  });

  it("falls back to a neutral default voice when no mapping is configured", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({ client, enabled: () => true });

    await synthesize("hello");

    expect(calls[0]?.voice).toBeTruthy();
  });

  it("joins base and per-call instructions, skipping empties", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({
      client,
      enabled: () => true,
      baseInstructions: "Speak warmly.",
    });

    await synthesize("hello", { instructions: "Slow down." });
    await synthesize("hello");

    expect(calls[0]?.instructions).toBe("Speak warmly. Slow down.");
    expect(calls[1]?.instructions).toBe("Speak warmly.");
  });

  it("passes model and speed overrides through", async () => {
    const { client, calls } = monoClient();
    const synthesize = createSynthesizer({
      client,
      enabled: () => true,
      model: "custom-tts",
      speed: 1.15,
    });

    await synthesize("hello");

    expect(calls[0]?.model).toBe("custom-tts");
    expect(calls[0]?.speed).toBe(1.15);
  });

  it("re-reads the enabled gate on every call", async () => {
    const { client } = monoClient();
    let on = false;
    const synthesize = createSynthesizer({ client, enabled: () => on });

    expect(await synthesize("hello")).toBeNull();
    on = true;
    expect(await synthesize("hello")).not.toBeNull();
  });
});

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { BucketsFor } from "@diegoaltoworks/chatter";
import { prepareChat, resolveBuckets } from "@diegoaltoworks/chatter";
import type { TalkerDependencies } from "../types";
import { chat } from "./chat";

/**
 * Plugin-mode chat tests, focused on the personaFn/channelHint/buckets
 * wiring into chatter's prepareChat.
 *
 * Only completeOnce is faked - prepareChat and resolveBuckets are chatter's
 * real implementations, so these tests exercise the actual wiring rather
 * than a hand-rolled stand-in for it.
 */

let lastSystem = "";
const completeOnce = mock(async ({ system }: { system: string }) => {
  lastSystem = system;
  return { content: "a reply" };
});

mock.module("@diegoaltoworks/chatter", () => ({ completeOnce, prepareChat, resolveBuckets }));

type Query = (query: string, topK: number, buckets: string[]) => Promise<string[]>;

function makeDeps(
  opts: {
    config?: Partial<TalkerDependencies["config"]>;
    query?: Query;
    bucketsFor?: BucketsFor;
  } = {},
): TalkerDependencies {
  const query: Query = opts.query ?? (async () => ["retrieved fact"]);
  return {
    chatter: {
      client: {},
      store: { query },
      prompts: { baseSystemRules: "BASE_RULES", publicPersona: "DEFAULT_PERSONA" },
      config: { bucketsFor: opts.bucketsFor },
    } as unknown as TalkerDependencies["chatter"],
    config: { ...opts.config },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

beforeEach(() => {
  lastSystem = "";
  completeOnce.mockClear();
});

describe("chat personaFn", () => {
  it("uses the default public persona when personaFn is absent", async () => {
    await chat(makeDeps(), "+4470001", "hello", "sms");
    expect(lastSystem).toContain("BASE_RULES");
    expect(lastSystem).toContain("DEFAULT_PERSONA");
    expect(lastSystem).toContain("retrieved fact");
  });

  it("replaces only the persona layer when personaFn returns a prompt", async () => {
    await chat(
      makeDeps({ config: { personaFn: async () => "AFRIKAANS_PERSONA" } }),
      "+4470001",
      "hello",
      "sms",
    );
    expect(lastSystem).toContain("BASE_RULES");
    expect(lastSystem).toContain("AFRIKAANS_PERSONA");
    expect(lastSystem).not.toContain("DEFAULT_PERSONA");
    expect(lastSystem).toContain("retrieved fact");
  });

  it("falls back to the default persona when personaFn returns null", async () => {
    await chat(makeDeps({ config: { personaFn: async () => null } }), "+4470001", "hello", "sms");
    expect(lastSystem).toContain("DEFAULT_PERSONA");
  });

  it("falls back to the default persona when personaFn throws", async () => {
    await chat(
      makeDeps({
        config: {
          personaFn: async () => {
            throw new Error("resolver exploded");
          },
        },
      }),
      "+4470001",
      "hello",
      "sms",
    );
    expect(lastSystem).toContain("DEFAULT_PERSONA");
  });

  it("supports a synchronous personaFn", async () => {
    await chat(
      makeDeps({ config: { personaFn: () => "SYNC_PERSONA" } }),
      "+4470001",
      "hello",
      "sms",
    );
    expect(lastSystem).toContain("SYNC_PERSONA");
  });

  it("passes the phone number and message to personaFn", async () => {
    let seen: [string, string] | undefined;
    await chat(
      makeDeps({
        config: {
          personaFn: (phoneNumber, message) => {
            seen = [phoneNumber, message];
            return null;
          },
        },
      }),
      "+4479999",
      "what is tofu",
      "sms",
    );
    expect(seen).toEqual(["+4479999", "what is tofu"]);
  });
});

describe("chat channelHint", () => {
  it("adds a call-specific hint for the call channel", async () => {
    await chat(makeDeps(), "+4470001", "hello", "call");
    expect(lastSystem).toContain("live phone call");
  });

  it("adds an sms-specific hint for the sms channel", async () => {
    await chat(makeDeps(), "+4470001", "hello", "sms");
    expect(lastSystem).toContain("SMS");
  });

  it("adds a whatsapp-specific hint for the whatsapp channel", async () => {
    await chat(makeDeps(), "+4470001", "hello", "whatsapp");
    expect(lastSystem).toContain("WhatsApp");
  });
});

describe("chat retrieval buckets", () => {
  it("retrieves from the default buckets when no bucketsFor is configured", async () => {
    let seenBuckets: string[] | undefined;
    const deps = makeDeps({
      query: async (_q, _k, buckets) => {
        seenBuckets = buckets;
        return ["retrieved fact"];
      },
    });
    await chat(deps, "+4470001", "hello", "sms");
    expect(seenBuckets).toEqual(["base", "public"]);
  });

  it("widens retrieval per-sender when bucketsFor grants extra buckets", async () => {
    let seenBuckets: string[] | undefined;
    const deps = makeDeps({
      query: async (_q, _k, buckets) => {
        seenBuckets = buckets;
        return ["itinerary fact"];
      },
      bucketsFor: ({ sender }) => (sender ? ["base", "public", "itinerary"] : undefined),
    });
    await chat(deps, "+4470001", "where is my flight", "sms");
    expect(seenBuckets).toEqual(["base", "public", "itinerary"]);
    expect(lastSystem).toContain("itinerary fact");
  });

  it("clamps a widened grant to the mode defaults when the sender is unidentified", async () => {
    let seenBuckets: string[] | undefined;
    const deps = makeDeps({
      query: async (_q, _k, buckets) => {
        seenBuckets = buckets;
        return ["retrieved fact"];
      },
      bucketsFor: () => ["base", "public", "private"],
    });
    // "unknown" is the sentinel talker's channels pass when Twilio omits a
    // sender - it must not be treated as an identified caller.
    await chat(deps, "unknown", "hello", "sms");
    expect(seenBuckets).toEqual(["base", "public"]);
  });

  it("does not silently fall back to default buckets when bucketsFor rejects", async () => {
    const deps = makeDeps({
      query: async () => ["retrieved fact"],
      bucketsFor: () => {
        throw new Error("policy lookup failed");
      },
    });
    const reply = await chat(deps, "+4470001", "hello", "sms");
    expect(reply).toBe("Sorry, I encountered an error processing your question.");
    expect(completeOnce).not.toHaveBeenCalled();
  });
});

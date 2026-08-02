import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { TalkerDependencies } from "../types";
import { chat } from "./chat";

/**
 * Plugin-mode chat tests, focused on the personaFn hook.
 *
 * The chatter package is mocked so no model call is made; each test inspects
 * the system prompt handed to completeOnce.
 */

let lastSystem = "";
const completeOnce = mock(async ({ system }: { system: string }) => {
  lastSystem = system;
  return { content: "a reply" };
});

mock.module("@diegoaltoworks/chatter", () => ({ completeOnce }));

function makeDeps(configOverrides: Partial<TalkerDependencies["config"]> = {}): TalkerDependencies {
  return {
    chatter: {
      client: {},
      store: { query: async () => ["retrieved fact"] },
      prompts: { baseSystemRules: "BASE_RULES", publicPersona: "DEFAULT_PERSONA" },
      config: {},
    } as unknown as TalkerDependencies["chatter"],
    config: { ...configOverrides },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

describe("chat personaFn", () => {
  beforeEach(() => {
    lastSystem = "";
    completeOnce.mockClear();
  });

  it("uses the default public persona when personaFn is absent", async () => {
    await chat(makeDeps(), "+4470001", "hello");
    expect(lastSystem).toContain("BASE_RULES");
    expect(lastSystem).toContain("DEFAULT_PERSONA");
    expect(lastSystem).toContain("retrieved fact");
  });

  it("replaces only the persona layer when personaFn returns a prompt", async () => {
    await chat(makeDeps({ personaFn: async () => "AFRIKAANS_PERSONA" }), "+4470001", "hello");
    expect(lastSystem).toContain("BASE_RULES");
    expect(lastSystem).toContain("AFRIKAANS_PERSONA");
    expect(lastSystem).not.toContain("DEFAULT_PERSONA");
    expect(lastSystem).toContain("retrieved fact");
  });

  it("falls back to the default persona when personaFn returns null", async () => {
    await chat(makeDeps({ personaFn: async () => null }), "+4470001", "hello");
    expect(lastSystem).toContain("DEFAULT_PERSONA");
  });

  it("falls back to the default persona when personaFn throws", async () => {
    await chat(
      makeDeps({
        personaFn: async () => {
          throw new Error("resolver exploded");
        },
      }),
      "+4470001",
      "hello",
    );
    expect(lastSystem).toContain("DEFAULT_PERSONA");
  });

  it("supports a synchronous personaFn", async () => {
    await chat(makeDeps({ personaFn: () => "SYNC_PERSONA" }), "+4470001", "hello");
    expect(lastSystem).toContain("SYNC_PERSONA");
  });

  it("passes the phone number and message to personaFn", async () => {
    let seen: [string, string] | undefined;
    await chat(
      makeDeps({
        personaFn: (phoneNumber, message) => {
          seen = [phoneNumber, message];
          return null;
        },
      }),
      "+4479999",
      "what is tofu",
    );
    expect(seen).toEqual(["+4479999", "what is tofu"]);
  });
});

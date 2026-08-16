/**
 * Outgoing Response Processor Tests
 *
 * Covers `TalkerConfig.replyLanguages`: unconfigured, the prompt sent to
 * OpenAI must be byte-identical to today's (no narrowing, no acknowledgment
 * instruction). Configured, a detected language outside the allowlist must
 * narrow `Respond in:` to the list's first entry and append the
 * `replyLanguageMismatch` phrase; a detected language already in the
 * allowlist must reply in kind with no acknowledgment appended.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import type { TalkerDependencies } from "../../types";

let capturedSystemPrompt = "";
const callOpenAI = mock(
  async (
    _deps: TalkerDependencies,
    systemPrompt: string,
    userMessage: string,
    _context: { phoneNumber: string; stage: "incoming" | "outgoing" },
  ) => {
    capturedSystemPrompt = systemPrompt;
    return userMessage;
  },
);
mock.module("./openai", () => ({ callOpenAI }));

// Dynamic import so it resolves after the mock.module() call above - a static
// import of ./outgoing would be hoisted ahead of the mock registration.
const { clearAllContexts, setDetectedLanguage } = await import("../context");
const { getPromptPhrase } = await import("../phrases");
const { processOutgoing } = await import("./outgoing");

function makeDeps(configOverrides: Partial<TalkerDependencies["config"]> = {}): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: { ...configOverrides },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

const PHONE = "+15551234567";

describe("processOutgoing reply-language narrowing", () => {
  afterEach(() => {
    clearAllContexts();
  });

  it("stays unrestricted and unchanged when replyLanguages is unset", async () => {
    setDetectedLanguage(PHONE, "fr");
    await processOutgoing(makeDeps(), PHONE, "hello", "call");
    expect(capturedSystemPrompt).toContain("Respond in: fr");
    expect(capturedSystemPrompt).not.toContain(getPromptPhrase("en", "replyLanguageMismatch"));
  });

  it("narrows to the allowlist's first entry and appends the acknowledgment for an out-of-list language", async () => {
    setDetectedLanguage(PHONE, "fr");
    await processOutgoing(makeDeps({ replyLanguages: ["en", "pt"] }), PHONE, "hello", "call");
    expect(capturedSystemPrompt).toContain("Respond in: en");
    expect(capturedSystemPrompt).toContain(getPromptPhrase("en", "replyLanguageMismatch"));
  });

  it("replies in kind with no acknowledgment when the detected language is in the allowlist", async () => {
    setDetectedLanguage(PHONE, "pt");
    await processOutgoing(makeDeps({ replyLanguages: ["en", "pt"] }), PHONE, "hello", "call");
    expect(capturedSystemPrompt).toContain("Respond in: pt");
    expect(capturedSystemPrompt).not.toContain(getPromptPhrase("pt", "replyLanguageMismatch"));
  });
});

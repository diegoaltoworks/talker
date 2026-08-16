/**
 * OpenAI Request Config Resolution Tests
 *
 * See openai-request.ts for why this is tested as a pure function rather
 * than by mocking `fetch` around the real `callOpenAI` - several route
 * tests `mock.module()` that module process-globally for the whole test
 * run, which would make asserting against the real implementation here
 * order-dependent and flaky.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildChatRequestBody,
  DEFAULT_OPENAI_API_URL,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  DEFAULT_PROCESSING_TEMPERATURE,
  resolveOpenAIRequestConfig,
} from "./openai-request";

describe("resolveOpenAIRequestConfig", () => {
  it("defaults to the public OpenAI chat completions URL, a 5s timeout and temperature 0.3", () => {
    expect(resolveOpenAIRequestConfig(undefined)).toEqual({
      apiUrl: DEFAULT_OPENAI_API_URL,
      timeoutMs: DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
      temperature: DEFAULT_PROCESSING_TEMPERATURE,
    });
  });

  // Pinned to the literal, not just the constant it equals today: the
  // ~15s webhook budget math in openai-request.ts's docstring (two
  // sequential calls must fit well under half the budget) depends on this
  // exact value, so a change here should read as a deliberate edit to that
  // docstring's reasoning, not slip through as an untouched default.
  it("defaults the timeout to exactly 5000ms", () => {
    expect(DEFAULT_OPENAI_REQUEST_TIMEOUT_MS).toBe(5000);
  });

  it("honours a configured baseUrl", () => {
    const result = resolveOpenAIRequestConfig({
      baseUrl: "https://gateway.internal/v1/chat/completions",
    });
    expect(result.apiUrl).toBe("https://gateway.internal/v1/chat/completions");
  });

  it("honours a configured requestTimeoutMs", () => {
    const result = resolveOpenAIRequestConfig({ requestTimeoutMs: 3000 });
    expect(result.timeoutMs).toBe(3000);
  });

  it("honours a configured temperature", () => {
    const result = resolveOpenAIRequestConfig({ temperature: 0.9 });
    expect(result.temperature).toBe(0.9);
  });

  it("falls back to defaults for an empty processing config", () => {
    expect(resolveOpenAIRequestConfig({})).toEqual({
      apiUrl: DEFAULT_OPENAI_API_URL,
      timeoutMs: DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
      temperature: DEFAULT_PROCESSING_TEMPERATURE,
    });
  });

  // The number above is internal; the one a host reads is the `Default:` in
  // `ProcessingConfig.requestTimeoutMs`'s JSDoc, which ships in the .d.ts and
  // is what a consumer budgets their webhook against. The two drifted once
  // (the doc kept saying 8000 after the default moved to 5000), so the doc is
  // pinned to the constant here rather than left to review.
  it("documents the same default in the published ProcessingConfig JSDoc", () => {
    const types = readFileSync(join(import.meta.dir, "..", "..", "types.ts"), "utf8");
    const doc = types.slice(0, types.indexOf("requestTimeoutMs?: number;"));
    const documented = [...doc.matchAll(/Default: (\d+)/g)].at(-1)?.[1];
    expect(documented).toBe(String(DEFAULT_OPENAI_REQUEST_TIMEOUT_MS));
  });
});

describe("buildChatRequestBody", () => {
  // callOpenAI (./openai.ts) is mock.module()'d process-wide by several
  // route tests, so this proves the resolved temperature actually reaches
  // the request body through the one function callOpenAI delegates to,
  // rather than through the untestable specifier itself.
  it("puts the given temperature on the request body, not a hardcoded literal", () => {
    const body = buildChatRequestBody("gpt-4o-mini", "system prompt", "user message", 0.9);
    expect(body).toEqual({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user message" },
      ],
      temperature: 0.9,
    });
  });
});

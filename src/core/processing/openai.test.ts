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
import {
  DEFAULT_OPENAI_API_URL,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  resolveOpenAIRequestConfig,
} from "./openai-request";

describe("resolveOpenAIRequestConfig", () => {
  it("defaults to the public OpenAI chat completions URL and an 8s timeout", () => {
    expect(resolveOpenAIRequestConfig(undefined)).toEqual({
      apiUrl: DEFAULT_OPENAI_API_URL,
      timeoutMs: DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
    });
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

  it("falls back to defaults for an empty processing config", () => {
    expect(resolveOpenAIRequestConfig({})).toEqual({
      apiUrl: DEFAULT_OPENAI_API_URL,
      timeoutMs: DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
    });
  });
});

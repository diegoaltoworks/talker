/**
 * See openai-fetch.ts for why this is exercised directly against a mocked
 * `fetch` in its own file rather than through the real `callOpenAI` from
 * `./openai` - that specifier is `mock.module()`d process-wide by several
 * route tests elsewhere in the suite.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { fetchOpenAIChatCompletion } from "./openai-fetch";

describe("fetchOpenAIChatCompletion", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends the request to the given apiUrl, not a hardcoded default", async () => {
    let capturedUrl = "";
    global.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAIChatCompletion(
      "https://gateway.internal/v1/chat/completions",
      { Authorization: "Bearer x" },
      { model: "gpt-4o-mini" },
      5000,
    );

    expect(capturedUrl).toBe("https://gateway.internal/v1/chat/completions");
  });

  it("aborts the request once the timeout elapses", async () => {
    let sawSignal: AbortSignal | undefined;
    global.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      sawSignal = init?.signal ?? undefined;
      // Never resolves on its own - only the abort signal ends this call,
      // exactly like a genuinely hung upstream request would.
      return new Promise<Response>((_resolve, reject) => {
        sawSignal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    }) as unknown as typeof fetch;

    await expect(
      fetchOpenAIChatCompletion("https://api.openai.com/v1/chat/completions", {}, {}, 5),
    ).rejects.toThrow();

    expect(sawSignal?.aborted).toBe(true);
  });
});

/**
 * OpenAI Fetch Wiring
 *
 * Pulled out of openai.ts as its own function, tested directly against a
 * mocked `fetch`, for the same reason `resolveOpenAIRequestConfig` lives in
 * its own file - several route tests `mock.module()` the whole `./openai`
 * module process-wide for the test run (Bun's module mocks are not scoped to
 * the file that set them), which would make a behavioral test against the
 * real `callOpenAI` from that same specifier flaky depending on file
 * execution order. A distinct specifier that nothing else mocks stays real.
 */

/** Issue the chat-completions request, aborting once `timeoutMs` elapses. */
export function fetchOpenAIChatCompletion(
  apiUrl: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  return fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

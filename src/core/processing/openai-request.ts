/**
 * OpenAI Request Config Resolution
 *
 * Pulled out of openai.ts as a pure function so it can be unit tested
 * without touching `fetch` - several route tests `mock.module()` the whole
 * `./openai` module (Bun's module mocks are process-global and permanent
 * for the test run, not scoped to the file that set them - see those tests'
 * own comments), which would make a test importing the real `callOpenAI`
 * from that same specifier flaky depending on file execution order.
 */

import type { ProcessingConfig } from "../../types";

export const DEFAULT_OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * A single call's default. `processCall`/`processMessage` make up to two of
 * these sequentially (processIncoming, then processOutgoing, with a chat()
 * turn between them) inside one Twilio webhook, which must return within
 * ~15s - an 8s-per-call default would let two hangs alone exceed that, so
 * this is deliberately well under half the budget.
 */
export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 5000;

export function resolveOpenAIRequestConfig(processing?: ProcessingConfig): {
  apiUrl: string;
  timeoutMs: number;
} {
  return {
    apiUrl: processing?.baseUrl || DEFAULT_OPENAI_API_URL,
    timeoutMs: processing?.requestTimeoutMs ?? DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  };
}

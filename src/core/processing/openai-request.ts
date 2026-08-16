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

/**
 * Default sampling temperature for the pre/post-processing pipeline's
 * structured, single-answer tasks (language detection, transfer/end-call
 * intent, message cleanup) - low enough to keep those deterministic without
 * pinning to 0.
 */
export const DEFAULT_PROCESSING_TEMPERATURE = 0.3;

export function resolveOpenAIRequestConfig(processing?: ProcessingConfig): {
  apiUrl: string;
  timeoutMs: number;
  temperature: number;
} {
  return {
    apiUrl: processing?.baseUrl || DEFAULT_OPENAI_API_URL,
    timeoutMs: processing?.requestTimeoutMs ?? DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
    temperature: processing?.temperature ?? DEFAULT_PROCESSING_TEMPERATURE,
  };
}

export interface ChatCompletionRequestBody {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
}

/**
 * Pure request-body assembly, split out of `callOpenAI` (`./openai.ts`) for
 * the same reason `resolveOpenAIRequestConfig` is: that specifier is
 * `mock.module()`d process-wide by several route tests, which would make a
 * test against the real function flaky depending on file execution order.
 * A distinct specifier that nothing else mocks stays directly testable, so
 * this is where `temperature` actually reaching the request body is proven.
 */
export function buildChatRequestBody(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
): ChatCompletionRequestBody {
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature,
  };
}

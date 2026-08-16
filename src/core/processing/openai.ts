/**
 * OpenAI API Client
 *
 * Low-level fetch wrapper for the talker processing pipeline.
 * Uses fetch directly (no SDK) to keep dependencies minimal.
 */

import type { TalkerDependencies } from "../../types";
import { logger } from "../logger";
import { fetchOpenAIChatCompletion } from "./openai-fetch";
import { resolveOpenAIRequestConfig } from "./openai-request";

/**
 * Call OpenAI chat completions API.
 *
 * A raw fetch, not the injected `OpenAI` SDK client, so this stays reachable
 * without the `openai` peer being installed (see peer-deps.test.ts). Honours
 * `processing.baseUrl` so a host routing through Azure OpenAI or a gateway
 * isn't silently bypassed, and aborts after `processing.requestTimeoutMs` so
 * a hung upstream request can't hold a /call, /sms or /whatsapp webhook open
 * indefinitely - callers already fall back to the original text on any
 * rejection here.
 */
export async function callOpenAI(
  deps: TalkerDependencies,
  systemPrompt: string,
  userMessage: string,
  context: { phoneNumber: string; stage: "incoming" | "outgoing" },
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${deps.openaiApiKey}`,
    "Content-Type": "application/json",
  };

  const requestBody = {
    model: deps.openaiModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
  };

  logger.info(`${context.stage} request`, {
    phoneNumber: context.phoneNumber,
    stage: context.stage,
    input: userMessage,
  });

  const { apiUrl, timeoutMs } = resolveOpenAIRequestConfig(deps.config.processing);

  const response = await fetchOpenAIChatCompletion(apiUrl, headers, requestBody, timeoutMs);

  if (!response.ok) {
    const error = await response.text();
    logger.error(`${context.stage} openai error`, {
      phoneNumber: context.phoneNumber,
      status: response.status,
      error,
    });
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const content = data.choices[0]?.message?.content || "";

  logger.info(`${context.stage} response`, {
    phoneNumber: context.phoneNumber,
    stage: context.stage,
    output: content,
    tokens: data.usage?.total_tokens,
  });

  return content;
}

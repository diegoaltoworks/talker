/**
 * OpenAI API Client
 *
 * Low-level fetch wrapper for the talker processing pipeline.
 * Uses fetch directly (no SDK) to keep dependencies minimal.
 */

import type { TalkerDependencies } from "../../types";
import { logger } from "../logger";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Call OpenAI chat completions API
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
    input: userMessage.substring(0, 160) + (userMessage.length > 160 ? "..." : ""),
  });

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

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
    output: content.substring(0, 160) + (content.length > 160 ? "..." : ""),
    tokens: data.usage?.total_tokens,
  });

  return content;
}

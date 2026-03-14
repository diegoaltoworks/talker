/**
 * LLM-powered Intent Detection
 *
 * Classifies user messages into flow intents using OpenAI.
 */

import { logger } from "../core/logger";
import type { IntentDetection, LoadedFlow, TalkerDependencies } from "../types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Detect user intent using LLM
 */
export async function detectIntent(
  deps: TalkerDependencies,
  phoneNumber: string,
  userMessage: string,
  flows: Map<string, LoadedFlow>,
  conversationContext?: string[],
): Promise<IntentDetection> {
  const contextStr =
    conversationContext && conversationContext.length > 0
      ? `\n\nRecent conversation:\n${conversationContext.join("\n")}`
      : "";

  // Build flow descriptions from loaded flows
  const flowDescriptions = Array.from(flows.entries())
    .map(([id, flow], index) => {
      const keywords = flow.definition.triggerKeywords.join(", ");
      return `${index + 1}. ${id} -- ${flow.definition.description}\n   - Keywords: ${keywords}`;
    })
    .join("\n\n");

  const systemPrompt = `You are an intent detector for a voice assistant.

Detect ONE category. Use these EXACT ids (they must match flow ids):

${flowDescriptions}

${flows.size + 1}. chatbot -- All other questions (general fallback)
${contextStr}

Return JSON with:
- "intent": one of the ids above (exact string)
- "confidence": 0.0-1.0 (how certain you are)
- "reasoning": brief explanation

Rules:
- If uncertain, always return "chatbot" with low confidence`;

  const requestBody = {
    model: deps.openaiModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  logger.info("detecting intent", {
    phoneNumber,
    msg: userMessage.substring(0, 160),
    hasContext: !!conversationContext && conversationContext.length > 0,
  });

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("intent detection error", { phoneNumber, status: response.status, error });
      return { intent: "chatbot", confidence: 0.0, reasoning: "API error, defaulting to chatbot" };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content || "{}";
    const raw = JSON.parse(content) as IntentDetection;

    // Normalize to valid flow ids
    const validFlowIds = new Set(flows.keys());
    const normalizedIntent = validFlowIds.has(raw.intent) ? raw.intent : "chatbot";

    const result: IntentDetection = {
      intent: normalizedIntent,
      confidence: raw.confidence,
      reasoning: raw.reasoning,
    };

    logger.info("intent detected", {
      phoneNumber,
      intent: result.intent,
      confidence: result.confidence,
      reasoning: result.reasoning,
    });

    return result;
  } catch (error) {
    logger.error("intent detection exception", {
      phoneNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      intent: "chatbot",
      confidence: 0.0,
      reasoning: "Exception occurred, defaulting to chatbot",
    };
  }
}

/**
 * Parameter Extraction
 *
 * Uses OpenAI to extract structured parameters from user messages
 * based on flow schema definitions.
 */

import { readFileSync } from "node:fs";
import { logger } from "../core/logger";
import type { FlowExtractionResult, LoadedFlow, TalkerDependencies } from "../types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Extract parameters from user message using OpenAI
 */
export async function extractParameters(
  deps: TalkerDependencies,
  flow: LoadedFlow,
  phoneNumber: string,
  userMessage: string,
  existingParams: Record<string, unknown>,
): Promise<FlowExtractionResult> {
  const instructions = readFileSync(flow.instructionsPath, "utf-8");
  const schema = flow.definition.schema;

  const properties = schema.properties || {};
  const required = schema.required || [];
  const schemaDescription = Object.entries(properties)
    .map(
      ([key, field]) =>
        `- ${key} (${field.type}${required.includes(key) ? ", required" : ""}): ${field.description || ""}`,
    )
    .join("\n");

  const existingParamsStr =
    Object.keys(existingParams).length > 0
      ? `\n\nAlready collected:\n${JSON.stringify(existingParams, null, 2)}`
      : "";

  const missingFields = required.filter((key: string) => !existingParams[key]);
  const currentlyAsking = missingFields.length > 0 ? missingFields[0] : null;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const nextYear = currentYear + 1;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const dateContext = `\n\n## CRITICAL DATE CONTEXT
TODAY IS: ${todayStr} (year ${currentYear}, month ${currentMonth})

**DATE EXTRACTION RULES:**
- "tomorrow" = ${tomorrowStr}
- Months 1-${currentMonth} = year ${nextYear}
- Months ${currentMonth + 1}-12 = year ${currentYear}
- NEVER output a date before ${todayStr}`;

  const currentFieldHint = currentlyAsking
    ? `\n\n## IMPORTANT CONTEXT
We just asked the user for: "${currentlyAsking}"
If the user's response is a simple value, interpret it as the value for the "${currentlyAsking}" parameter.`
    : "";

  const systemPrompt = `${instructions}
${dateContext}

## Schema
${schemaDescription}
${existingParamsStr}
${currentFieldHint}

## Task
Extract any parameters from the user's message that match the schema above.
Return JSON with:
- "extractedParams": object with any NEW parameters found
- "allParamsFilled": boolean indicating if ALL required params are now complete

If not all params are filled, do NOT include "nextPrompt" - we'll generate that separately.`;

  const requestBody = {
    model: deps.openaiModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  };

  logger.info("flow extracting params", {
    phoneNumber,
    flow: flow.definition.id,
    msg: userMessage.substring(0, 160),
    existing: Object.keys(existingParams).length > 0 ? existingParams : undefined,
    askingFor: currentlyAsking || "none",
  });

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
    logger.error("flow parameter extraction error", {
      phoneNumber,
      flowName: flow.definition.id,
      status: response.status,
      error,
    });
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content || "{}";
  const result = JSON.parse(content) as {
    extractedParams?: Record<string, unknown>;
    allParamsFilled?: boolean;
  };

  const mergedParams = { ...existingParams, ...(result.extractedParams || {}) };
  const requiredFields = schema.required || [];
  const allRequiredFilled = requiredFields.every(
    (key: string) => mergedParams[key] !== undefined && mergedParams[key] !== null,
  );

  logger.info("flow params extracted", {
    phoneNumber,
    flow: flow.definition.id,
    extracted: result.extractedParams,
    complete: allRequiredFilled,
  });

  // Find next missing required param
  let nextPrompt: string | undefined;
  if (!allRequiredFilled) {
    const missingKey = requiredFields.find(
      (key: string) => mergedParams[key] === undefined || mergedParams[key] === null,
    );
    if (missingKey) {
      nextPrompt = `What is the ${missingKey.replace(/([A-Z])/g, " $1").toLowerCase()}?`;
    }
  }

  return {
    extractedParams: result.extractedParams || {},
    allParamsFilled: allRequiredFilled,
    nextPrompt,
  };
}

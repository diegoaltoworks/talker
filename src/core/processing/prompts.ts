/**
 * Prompt Loader
 *
 * Loads and caches system prompts for the incoming/outgoing processing pipeline.
 * Looks in custom paths first, then falls back to built-in prompts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TalkerDependencies } from "../../types";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";

let incomingPrompt: string | null = null;
let outgoingPrompt: string | null = null;

function loadPromptFile(filename: string, customPath?: string): string {
  if (customPath && existsSync(customPath)) {
    return readFileSync(customPath, "utf-8");
  }

  const builtinPath = join(__dirname, "../../../prompts", filename);
  if (existsSync(builtinPath)) {
    return readFileSync(builtinPath, "utf-8");
  }

  throw new Error(`Prompt file not found: ${filename}`);
}

export function getIncomingPrompt(deps: TalkerDependencies): string {
  if (!incomingPrompt) {
    try {
      incomingPrompt = loadPromptFile("incoming.md", deps.config.processing?.incomingPromptPath);
      logger.info("incoming prompt loaded");
    } catch (error) {
      logger.error("failed to load incoming prompt", { error: getErrorMessage(error) });
      incomingPrompt =
        "Return JSON with shouldTransfer (boolean), shouldEndCall (boolean), detectedLanguage (string), processedMessage (string)";
    }
  }
  return incomingPrompt;
}

export function getOutgoingPrompt(deps: TalkerDependencies): string {
  if (!outgoingPrompt) {
    try {
      outgoingPrompt = loadPromptFile("outgoing.md", deps.config.processing?.outgoingPromptPath);
      logger.info("outgoing prompt loaded");
    } catch (error) {
      logger.error("failed to load outgoing prompt", { error: getErrorMessage(error) });
      outgoingPrompt = "Make this response phone-friendly and brief.";
    }
  }
  return outgoingPrompt;
}

/**
 * Reset prompt cache (for testing)
 */
export function resetPromptCache(): void {
  incomingPrompt = null;
  outgoingPrompt = null;
}

/**
 * Prompt Loader
 *
 * Loads and caches system prompts for the incoming/outgoing processing pipeline.
 * Looks in custom paths first, then falls back to built-in prompts (inlined).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TalkerDependencies } from "../../types";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";

let incomingPrompt: string | null = null;
let outgoingPrompt: string | null = null;

/** Try custom path, then built-in directory, then return undefined */
function loadPromptFile(filename: string, customPath?: string): string | undefined {
  // Custom path takes priority
  if (customPath && existsSync(customPath)) {
    return readFileSync(customPath, "utf-8");
  }

  // Try common locations relative to this file
  const candidates = [
    join(__dirname, "../../../prompts", filename), // source: src/core/processing/ -> prompts/
    join(__dirname, "../../prompts", filename), // dist: dist/ -> prompts/
    join(__dirname, "../prompts", filename), // flat dist
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  }

  return undefined;
}

// biome-ignore lint/style/noUnusedTemplateLiteral: multiline prompt content
const DEFAULT_INCOMING_PROMPT = `# Incoming Message Processor

You are a pre-processor for a voice assistant. Your job is to analyze incoming caller speech and determine three things:

1. Should the caller be transferred to a human directly?
2. What language is the caller speaking?
3. What is the cleaned-up version of their message to send to the knowledge base?

## IMPORTANT: Conversation Context

You may receive conversation history along with the current message. **You MUST consider the context** when making decisions.

## Language Detection

Detect the language the caller is speaking. Supported: "en", "fr", "nl", "de", "es", "pt". Default: "en".

## Transfer Detection

Transfer if the caller expresses: "speak to someone", "talk to a person", "connect me", "real person", "human", frustration signals, or complex/personal matters.

## End Call Detection

End call if: "no thanks", "that's all", "goodbye", "bye", "I'm done", "nothing else". Only if clearly ending the conversation.

## Response Format

Respond with valid JSON:
\`\`\`json
{
  "shouldTransfer": true or false,
  "shouldEndCall": true or false,
  "detectedLanguage": "en" or "fr" or "nl" or "de" or "es" or "pt",
  "processedMessage": "the cleaned up message"
}
\`\`\`

## Message Cleaning Rules

- Fix obvious speech-to-text errors
- Remove filler words (um, uh, like, you know)
- Keep the core intent and original language intact`;

// biome-ignore lint/style/noUnusedTemplateLiteral: multiline prompt content
const DEFAULT_OUTGOING_PROMPT = `# Outgoing Response Processor

You are a post-processor for a voice assistant. Transform knowledge base responses into channel-appropriate messages.

## Channel Type

You will be told the channel: "call" (phone), "sms" (text message), or "whatsapp".

**For CALL:** Spoken aloud by TTS. Convert numbers to words. Remove URLs. Max 2 sentences.
**For SMS:** Read on phone screen. Keep digits. Max 160 chars. No markdown.
**For WHATSAPP:** Read in chat. Keep digits and URLs. Can use *bold*, _italic_. Up to 500 chars.

## Language Requirement

You MUST respond in the specified language.

## Rules

1. Be concise - answer directly
2. End with a follow-up question
3. Always use third person
4. Remove markdown, lists, technical jargon

Return ONLY the transformed text. No JSON, no explanations.`;

export function getIncomingPrompt(deps: TalkerDependencies): string {
  if (!incomingPrompt) {
    const loaded = loadPromptFile("incoming.md", deps.config.processing?.incomingPromptPath);
    if (loaded) {
      incomingPrompt = loaded;
      logger.info("incoming prompt loaded from file");
    } else {
      incomingPrompt = DEFAULT_INCOMING_PROMPT;
      logger.info("incoming prompt loaded (built-in default)");
    }
  }
  return incomingPrompt;
}

export function getOutgoingPrompt(deps: TalkerDependencies): string {
  if (!outgoingPrompt) {
    const loaded = loadPromptFile("outgoing.md", deps.config.processing?.outgoingPromptPath);
    if (loaded) {
      outgoingPrompt = loaded;
      logger.info("outgoing prompt loaded from file");
    } else {
      outgoingPrompt = DEFAULT_OUTGOING_PROMPT;
      logger.info("outgoing prompt loaded (built-in default)");
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

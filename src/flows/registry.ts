/**
 * Flow Registry
 *
 * Central registry for loaded flows. Provides flow lookup, intent matching,
 * and instruction loading.
 */

import { readFileSync } from "node:fs";
import { logger } from "../core/logger";
import type { LoadedFlow, TalkerDependencies } from "../types";
import { detectIntent } from "./intent";
import { loadFlowsFromDirectory } from "./loader";

const CRITICAL_KEYWORDS = ["human", "person", "agent", "representative", "operator"];

export class FlowRegistry {
  private flows = new Map<string, LoadedFlow>();
  private flowsDir: string;

  constructor(flowsDir: string) {
    this.flowsDir = flowsDir;
  }

  /**
   * Load all flows from the flows directory
   */
  async loadFlows(): Promise<void> {
    this.flows = await loadFlowsFromDirectory(this.flowsDir);
  }

  /**
   * Get a flow by name
   */
  getFlow(name: string): LoadedFlow | undefined {
    return this.flows.get(name);
  }

  /**
   * Match user message to a flow using hybrid approach:
   * 1. Critical keyword detection (immediate)
   * 2. LLM intent classification
   */
  async matchFlow(
    deps: TalkerDependencies,
    phoneNumber: string,
    message: string,
    conversationContext?: string[],
  ): Promise<LoadedFlow | undefined> {
    const lowerMessage = message.toLowerCase();

    // Step 1: Check critical keywords
    for (const keyword of CRITICAL_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        const transferFlow = this.flows.get("transfer");
        if (transferFlow) {
          logger.info("flow triggered (critical keyword)", {
            flowId: transferFlow.definition.id,
            keyword,
          });
          return transferFlow;
        }
      }
    }

    // Step 2: LLM intent detection
    if (this.flows.size === 0) return undefined;

    // In tests, use deterministic detector
    const detection =
      process.env.NODE_ENV === "test"
        ? testModeDetectIntent(message)
        : await detectIntent(deps, phoneNumber, message, this.flows, conversationContext);

    if (detection.confidence >= 0.7) {
      const flow = this.flows.get(detection.intent);
      if (flow) {
        logger.info("flow triggered (LLM detection)", {
          flowId: flow.definition.id,
          intent: detection.intent,
          confidence: detection.confidence,
        });
        return flow;
      }
    }

    return undefined;
  }

  /**
   * Get all loaded flows
   */
  getAllFlows(): LoadedFlow[] {
    return Array.from(this.flows.values());
  }

  /**
   * Get flow instructions content
   */
  getInstructions(flowName: string): string {
    const flow = this.flows.get(flowName);
    if (!flow) {
      throw new Error(`Flow ${flowName} not found`);
    }
    return readFileSync(flow.instructionsPath, "utf-8");
  }
}

// Test-mode intent detector (deterministic, avoids network in tests)
function testModeDetectIntent(message: string) {
  const m = message.toLowerCase();
  if (m.match(/\b(add|sum|plus)\b/)) {
    return { intent: "addNumbers", confidence: 0.99, reasoning: "test-mode mapping" };
  }
  return { intent: "chatbot", confidence: 0.4, reasoning: "test-mode default" };
}

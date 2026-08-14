/**
 * Flow Registry
 *
 * Central registry for loaded flows. Provides flow lookup, intent matching,
 * and instruction loading. LLM intent detection is sourced from chatter's
 * flow engine (`@diegoaltoworks/chatter/flows`) instead of a duplicate
 * raw-fetch implementation; directory loading stays talker's own (see
 * `./loader.ts` - chatter's loader requires at least one schema property per
 * flow, which would silently drop zero-parameter flows like this registry's
 * own keyword-triggered "transfer" handoff).
 */

import { readFileSync } from "node:fs";
import { detectIntent } from "@diegoaltoworks/chatter/flows";
import { logger } from "../core/logger";
import type { LoadedFlow, TalkerDependencies } from "../types";
import { loadFlowsFromDirectory } from "./loader";
import { toChatterFlow } from "./types-adapter";

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
            phoneNumber,
            flowId: transferFlow.definition.id,
            keyword,
          });
          return transferFlow;
        }
      }
    }

    // Step 2: LLM intent detection
    if (this.flows.size === 0) return undefined;

    logger.info("detecting intent", {
      phoneNumber,
      msg: message.substring(0, 160),
      hasContext: !!conversationContext && conversationContext.length > 0,
    });

    const chatterFlows = new Map(
      Array.from(this.flows, ([id, flow]) => [id, toChatterFlow(flow)] as const),
    );
    const detection = await detectIntent(
      deps.chatter.client,
      deps.openaiModel,
      message,
      chatterFlows,
      conversationContext,
    );

    logger.info("intent detected", {
      phoneNumber,
      intent: detection.intent,
      confidence: detection.confidence,
      reasoning: detection.reasoning,
    });

    if (detection.confidence >= 0.7) {
      const flow = this.flows.get(detection.intent);
      if (flow) {
        logger.info("flow triggered (LLM detection)", {
          phoneNumber,
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

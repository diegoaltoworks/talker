/**
 * Flow Registry
 *
 * Central registry for loaded flows. Provides flow lookup, intent matching,
 * and instruction loading. LLM intent detection is sourced from chatter's
 * flow engine (`@diegoaltoworks/chatter/flows`) instead of a duplicate
 * raw-fetch implementation, loaded on demand so the optional peer stays
 * optional (see `./engine.ts`); directory loading stays talker's own (see
 * `./loader.ts` - chatter's loader requires at least one schema property per
 * flow, which would silently drop zero-parameter flows like this registry's
 * own keyword-triggered "transfer" handoff).
 */

import { readFileSync } from "node:fs";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import type { TalkerDependencies } from "../types";
import { type FlowEngine, type FlowEngineLoader, loadFlowEngine } from "./engine";
import { loadFlowsFromDirectory } from "./loader";
import type { LoadedFlow } from "./types";
import { toChatterFlow } from "./types-adapter";

/** Minimum LLM intent-detection confidence to trigger a flow (see `matchFlow`). */
const INTENT_CONFIDENCE_THRESHOLD = 0.7;

const CRITICAL_KEYWORDS = ["human", "person", "agent", "representative", "operator"];
// Word-bounded with an optional plural "s" - "person" must not fire on
// "personality", but "agents"/"humans" must still fire.
const CRITICAL_KEYWORD_MATCHERS = CRITICAL_KEYWORDS.map((keyword) => ({
  keyword,
  pattern: new RegExp(`\\b${keyword}s?\\b`, "i"),
}));

export class FlowRegistry {
  private flows = new Map<string, LoadedFlow>();
  private flowsDir: string;
  private engineLoader: FlowEngineLoader;

  /**
   * @param flowsDir Directory of flow definitions.
   * @param engineLoader Override for chatter's flow engine (tests only).
   */
  constructor(flowsDir: string, engineLoader: FlowEngineLoader = loadFlowEngine) {
    this.flowsDir = flowsDir;
    this.engineLoader = engineLoader;
  }

  /**
   * Chatter's flow engine, loaded on first use. The registry owns the handle
   * so `processFlow` reaches the engine through the same seam.
   *
   * Rejects with an actionable message when the optional peer is absent.
   */
  getEngine(): Promise<FlowEngine> {
    return this.engineLoader();
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
    // Step 1: Check critical keywords
    for (const { keyword, pattern } of CRITICAL_KEYWORD_MATCHERS) {
      if (pattern.test(message)) {
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

    // Step 2: LLM intent detection. Keyword matching above needs no peer, so
    // a host without chatter installed keeps its critical handoff; intent
    // detection degrades to "no flow matched" with an actionable log line
    // rather than failing the webhook.
    if (this.flows.size === 0) return undefined;

    if (!deps.openaiClient) {
      // Reachable only if a host builds TalkerDependencies by hand instead
      // of via createTelephonyRoutes/createStandaloneServer - both populate
      // openaiClient exactly when a flow could ever reach here.
      logger.warn("flow intent detection unavailable: deps.openaiClient is unset", {
        phoneNumber,
      });
      return undefined;
    }

    let detectIntent: FlowEngine["detectIntent"];
    try {
      ({ detectIntent } = await this.getEngine());
    } catch (error) {
      logger.error("flow intent detection unavailable", {
        phoneNumber,
        error: getErrorMessage(error),
      });
      return undefined;
    }

    logger.info("detecting intent", {
      phoneNumber,
      msg: message,
      hasContext: !!conversationContext && conversationContext.length > 0,
    });

    const chatterFlows = new Map(
      Array.from(this.flows, ([id, flow]) => [id, toChatterFlow(flow)] as const),
    );
    const detection = await detectIntent(
      deps.openaiClient,
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

    if (detection.confidence >= INTENT_CONFIDENCE_THRESHOLD) {
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

/**
 * Flow Manager
 *
 * Orchestrates the flow lifecycle: triggering, parameter collection,
 * execution, and cleanup.
 */

import {
  clearActiveFlow,
  getActiveFlow,
  getDetectedLanguage,
  getMessageHistory,
  setActiveFlow,
  updateFlowParams,
} from "../core/context";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import type { Channel, FlowResult, TalkerDependencies } from "../types";
import { extractParameters } from "./params";
import type { FlowRegistry } from "./registry";
import { shouldExitFlow as checkExitFlow, getExitMessage } from "./utils";

export { shouldExitFlow } from "./utils";

/**
 * Process a flow for a user message
 */
export async function processFlow(
  deps: TalkerDependencies,
  registry: FlowRegistry,
  phoneNumber: string,
  userMessage: string,
  channel: Channel,
): Promise<FlowResult> {
  const activeFlow = getActiveFlow(phoneNumber);

  // Check if user wants to exit flow
  if (activeFlow && checkExitFlow(userMessage)) {
    logger.info("flow cancelled", { phoneNumber, flow: activeFlow.flowName });
    clearActiveFlow(phoneNumber);
    const language = getDetectedLanguage(phoneNumber) || "en";
    return {
      isFlowActive: false,
      response: getExitMessage(language, deps.config.languageDir),
      flowCompleted: false,
    };
  }

  // If active flow exists, continue gathering params
  if (activeFlow) {
    const flow = registry.getFlow(activeFlow.flowName);
    if (!flow) {
      logger.error("active flow not found in registry", {
        phoneNumber,
        flowName: activeFlow.flowName,
      });
      clearActiveFlow(phoneNumber);
      return { isFlowActive: false, response: "", flowCompleted: false };
    }

    try {
      const extraction = await extractParameters(
        deps,
        flow,
        phoneNumber,
        userMessage,
        activeFlow.params as Record<string, unknown>,
      );

      updateFlowParams(phoneNumber, extraction.extractedParams);

      if (extraction.allParamsFilled) {
        logger.info("flow executing", {
          phoneNumber,
          flow: activeFlow.flowName,
          params: { ...activeFlow.params, ...extraction.extractedParams },
        });

        const result = await flow.handler(
          { ...activeFlow.params, ...extraction.extractedParams },
          { phoneNumber, channel },
        );
        clearActiveFlow(phoneNumber);

        return {
          isFlowActive: false,
          response: result.say,
          flowCompleted: true,
          smsContent: result.sms,
          flowSuccess: result.success,
        };
      }

      return {
        isFlowActive: true,
        response: extraction.nextPrompt || "Could you provide more details?",
        flowCompleted: false,
      };
    } catch (error) {
      logger.error("flow error", {
        phoneNumber,
        flow: activeFlow.flowName,
        error: getErrorMessage(error),
      });
      clearActiveFlow(phoneNumber);
      return {
        isFlowActive: false,
        response: "Sorry, I encountered an error. Let's start over.",
        flowCompleted: false,
      };
    }
  }

  // No active flow - check if message should trigger a new flow
  const conversationHistory = getMessageHistory(phoneNumber);
  const conversationContext = conversationHistory
    .slice(-5)
    .map((msg) => `${msg.role === "assistant" ? "Bot" : "User"}: ${msg.content}`);

  const matchedFlow = await registry.matchFlow(deps, phoneNumber, userMessage, conversationContext);
  if (matchedFlow) {
    const globalParams = matchedFlow.prefill ? matchedFlow.prefill(phoneNumber, {}) : {};

    logger.info("flow started", {
      phoneNumber,
      flow: matchedFlow.definition.id,
      msg: userMessage.substring(0, 160),
    });

    try {
      const extraction = await extractParameters(
        deps,
        matchedFlow,
        phoneNumber,
        userMessage,
        globalParams,
      );

      const mergedParams = { ...globalParams, ...extraction.extractedParams };
      setActiveFlow(phoneNumber, matchedFlow.definition.id, mergedParams);

      if (extraction.allParamsFilled) {
        logger.info("flow instant complete", {
          phoneNumber,
          flow: matchedFlow.definition.id,
          params: mergedParams,
        });

        const result = await matchedFlow.handler(mergedParams, { phoneNumber, channel });
        clearActiveFlow(phoneNumber);

        return {
          isFlowActive: false,
          response: result.say,
          flowCompleted: true,
          smsContent: result.sms,
          flowSuccess: result.success,
        };
      }

      return {
        isFlowActive: true,
        response: extraction.nextPrompt || "Could you provide more details?",
        flowCompleted: false,
      };
    } catch (error) {
      logger.error("flow init error", {
        phoneNumber,
        flow: matchedFlow.definition.id,
        error: getErrorMessage(error),
      });
      return { isFlowActive: false, response: "", flowCompleted: false };
    }
  }

  // No flow active or triggered
  return { isFlowActive: false, response: "", flowCompleted: false };
}

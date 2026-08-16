/**
 * Flow Types
 *
 * Types for talker's own flow presentation layer: definitions, handler
 * results, and the per-phone-number state persisted while a flow is active.
 * Re-exported from `../types` for backward compatibility with existing
 * imports.
 */

import type { Channel } from "../types";

export interface FlowSchemaProperty {
  type: "string" | "number" | "boolean";
  description?: string;
}

export interface FlowSchema {
  type: "object";
  properties: Record<string, FlowSchemaProperty>;
  required: string[];
}

/**
 * Highest `contractVersion` the loader understands. A flow.json naming a
 * version above this one fails to load with an actionable error rather than
 * being silently misinterpreted. Kept numerically aligned with chatter's own
 * `CURRENT_FLOW_CONTRACT_VERSION` (src/flows/types.ts there) even though this
 * is talker's own loader fork.
 */
export const CURRENT_FLOW_CONTRACT_VERSION = 1;

/**
 * Contract version assumed for a flow.json that omits `contractVersion`
 * entirely - every flow written before the field existed. Fixed at 1
 * forever: it names a point in this loader's history, not "whatever version
 * is current today". Filling an omitted field with {@link
 * CURRENT_FLOW_CONTRACT_VERSION} instead would relabel a pre-field flow as
 * compatible with a contract version it was never written against, the
 * moment `CURRENT_FLOW_CONTRACT_VERSION` is next bumped.
 */
export const LEGACY_FLOW_CONTRACT_VERSION = 1;

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  schema: FlowSchema;
  /** Defaults to {@link LEGACY_FLOW_CONTRACT_VERSION} when omitted. */
  contractVersion?: number;
}

export interface FlowState {
  flowName: string;
  params: Record<string, unknown>;
  attempts: number;
  startedAt: number;
}

export interface FlowHandlerResult {
  /**
   * Whether the flow itself completed successfully. When `false`, the SMS
   * and WhatsApp processors discard `say`/`sms`/`whatsapp` entirely and
   * substitute a generic, out-of-persona "processingError" phrase; a voice
   * call instead speaks `say` and transfers to `transferNumber`. A handler
   * that wants its own in-persona message to reach the caller for an
   * expected failure (rate limit, validation, a caught upstream error) must
   * still report `success: true` - `success: false` is reserved for
   * "something went wrong that a generic fallback should cover instead."
   */
  success: boolean;
  result?: unknown;
  /** What to say via voice/call */
  say: string;
  /** Delivered as the SMS reply body when non-empty; falls back to `say` otherwise */
  sms?: string;
  /** Delivered as the WhatsApp reply body when non-empty; falls back to `say` otherwise */
  whatsapp?: string;
}

export interface FlowHandlerContext {
  phoneNumber: string;
  channel: Channel;
}

export type FlowHandler = (
  params: Record<string, unknown>,
  context: FlowHandlerContext,
) => Promise<FlowHandlerResult>;

export type FlowPrefill = (
  phoneNumber: string,
  context: Record<string, unknown>,
) => Record<string, unknown>;

export interface FlowExtractionResult {
  extractedParams: Record<string, unknown>;
  allParamsFilled: boolean;
  nextPrompt?: string;
}

export interface IntentDetection {
  intent: string;
  confidence: number;
  reasoning?: string;
}

export interface LoadedFlow {
  definition: FlowDefinition;
  handler: FlowHandler;
  instructionsPath: string;
  prefill?: FlowPrefill;
}

export interface FlowResult {
  isFlowActive: boolean;
  response: string;
  flowCompleted: boolean;
  /** SMS-specific reply body, delivered by the SMS processor instead of `response` when non-empty */
  smsContent?: string;
  /** WhatsApp-specific reply body, delivered by the WhatsApp processor instead of `response` when non-empty */
  whatsappContent?: string;
  flowSuccess?: boolean;
  /** The user cancelled an active flow; `response` carries phrases.flow.cancelled */
  cancelled?: boolean;
  /** Flow processing failed (registry lookup, parameter extraction, or handler init); `response` carries phrases.flow.error */
  error?: boolean;
}

/**
 * Narrow structural adapter between talker's own flow types and chatter's
 * (`@diegoaltoworks/chatter/flows`). Every field is identical except
 * `handler`'s return shape - talker's handlers return
 * `{success, say, sms?, whatsapp?, result?}` and are always invoked directly
 * by talker's own `processFlow` (never by chatter's engine), so the cast is
 * confined to that one field rather than the whole object - a future field
 * added to either side's `LoadedFlow`/`FlowDefinition` still gets checked.
 */

import type {
  FlowHandler as ChatterFlowHandler,
  LoadedFlow as ChatterLoadedFlow,
} from "@diegoaltoworks/chatter/flows";
import type { LoadedFlow } from "./types";

export function toChatterFlow(flow: LoadedFlow): ChatterLoadedFlow {
  return { ...flow, handler: flow.handler as unknown as ChatterFlowHandler };
}

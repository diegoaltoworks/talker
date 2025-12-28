/**
 * Example: Creating Custom Flows
 *
 * Flows are structured conversations with parameter collection.
 * Each flow is a directory with three files:
 *
 *   config/flows/myFlow/
 *     flow.json         — Definition (id, name, description, triggerKeywords, schema)
 *     handler.ts         — Exports an execute() function
 *     instructions.md    — System prompt for parameter extraction
 *
 * This example shows the structure of each file.
 */

// --- config/flows/addNumbers/flow.json ---
const flowDefinition = {
  id: "addNumbers",
  name: "Add Two Numbers",
  description: "Adds two numbers together",
  triggerKeywords: ["add", "sum", "plus", "calculate"],
  schema: {
    type: "object",
    properties: {
      firstNumber: {
        type: "number",
        description: "The first number to add",
      },
      secondNumber: {
        type: "number",
        description: "The second number to add",
      },
    },
    required: ["firstNumber", "secondNumber"],
  },
};

// --- config/flows/addNumbers/handler.ts ---
// This must export an `execute` function:
//
// import type { FlowHandlerResult, FlowHandlerContext } from "@diegoaltoworks/talker";
//
// export async function execute(
//   params: Record<string, unknown>,
//   context: FlowHandlerContext,
// ): Promise<FlowHandlerResult> {
//   const a = Number(params.firstNumber);
//   const b = Number(params.secondNumber);
//   const sum = a + b;
//
//   return {
//     success: true,
//     result: sum,
//     say: `${a} plus ${b} equals ${sum}. Need anything else?`,
//     sms: `${a} + ${b} = ${sum}. Anything else?`,
//   };
// }

// --- config/flows/addNumbers/instructions.md ---
// # Add Numbers Flow
//
// Extract two numbers from the user's message.
// The user wants to add numbers together.
//
// Examples:
// - "add 5 and 7" -> firstNumber: 5, secondNumber: 7
// - "what is 10 plus 3" -> firstNumber: 10, secondNumber: 3
// - "sum of 100 and 200" -> firstNumber: 100, secondNumber: 200

console.log("See comments in this file for flow structure documentation.");
console.log("Flow definition example:", JSON.stringify(flowDefinition, null, 2));

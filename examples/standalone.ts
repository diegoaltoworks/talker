/**
 * Example: Standalone Talker Server (no Chatter)
 *
 * Use this when you have a chatbot running elsewhere (e.g., a chatter instance)
 * and want to add phone/SMS support that calls it over HTTP.
 *
 * Run: bun run examples/standalone.ts
 */

import { createStandaloneServer } from "../src";

async function start() {
  const app = await createStandaloneServer({
    // Required: OpenAI key for the pre/post-processing pipeline
    openaiApiKey: process.env.OPENAI_CHATGPT_KEY || "",

    // Remote chatbot API (e.g., a chatter instance)
    chatbot: {
      url: process.env.CHATBOT_URL || "http://localhost:8181/api/public/chat",
      apiKey: process.env.CHATBOT_API_KEY,
    },

    // Twilio credentials (optional — only needed for outbound SMS)
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    },

    // Transfer number for human handoff
    transferNumber: process.env.TRANSFER_NUMBER,

    // Optional: custom voices per language
    // voices: {
    //   en: { voice: "Polly.Amy", language: "en-US" },
    // },
  });

  Bun.serve({
    port: Number(process.env.PORT || 3000),
    fetch: app.fetch,
  });

  console.log("Standalone talker server running on port", process.env.PORT || 3000);
  console.log("  Call:    POST /call");
  console.log("  SMS:     POST /sms");
  console.log("  Health:  GET /healthz");
}

start().catch(console.error);

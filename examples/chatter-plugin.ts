/**
 * Example: Using Talker as a Chatter Plugin
 *
 * This is the recommended approach when you already have a chatter-based chatbot.
 * Talker mounts on the same Hono app, shares the OpenAI client, and queries
 * chatter's RAG pipeline directly (no HTTP hop).
 *
 * Run: bun run examples/chatter-plugin.ts
 */

import { createServer } from "@diegoaltoworks/chatter";
import type { ChatterConfig } from "@diegoaltoworks/chatter";
import { createTelephonyRoutes } from "../src";

async function start() {
  const chatterConfig: ChatterConfig = {
    bot: {
      name: "MyBot",
      personName: "John Doe",
      publicUrl: "https://mybot.example.com",
      description: "My chatbot with phone support",
    },
    openai: { apiKey: process.env.OPENAI_API_KEY || "" },
    database: {
      url: process.env.TURSO_URL || "",
      authToken: process.env.TURSO_AUTH_TOKEN || "",
    },
    // Talker mounts via customRoutes
    customRoutes: async (app, deps) => {
      await createTelephonyRoutes(app, deps, {
        // Twilio credentials (optional — only needed for outbound SMS)
        twilio: {
          accountSid: process.env.TWILIO_ACCOUNT_SID,
          authToken: process.env.TWILIO_AUTH_TOKEN,
          phoneNumber: process.env.TWILIO_PHONE_NUMBER,
        },

        // Phone number to transfer calls to when human handoff is requested
        transferNumber: process.env.TRANSFER_NUMBER,

        // Custom flow definitions directory (optional)
        flowsDir: "./config/flows",

        // Custom language files (optional — falls back to built-in)
        // languageDir: "./config/language",

        // Custom prompts for the pre/post-processing pipeline (optional)
        // processing: {
        //   model: "gpt-4o-mini",
        //   incomingPromptPath: "./config/prompts/telephony-incoming.md",
        //   outgoingPromptPath: "./config/prompts/telephony-outgoing.md",
        // },

        // Enable the "one moment please" pattern for first message
        // features: { thinkingAcknowledgmentEnabled: true },
      });
    },
  };

  const app = await createServer(chatterConfig);

  // One server, one port — web chat + phone + SMS
  Bun.serve({
    port: Number(process.env.PORT || 8181),
    fetch: app.fetch,
  });

  console.log("Server running on port", process.env.PORT || 8181);
  console.log("  Web chat:  POST /api/public/chat");
  console.log("  Call:      POST /call");
  console.log("  SMS:       POST /sms");
  console.log("  Health:    GET /healthz");
}

start().catch(console.error);

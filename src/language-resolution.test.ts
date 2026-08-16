/**
 * Language-resolution tests.
 *
 * Detection runs once, on the caller's first utterance, and every phrase
 * spoken or sent afterwards has to follow it. The phrase guard
 * (`src/phrase-guard.test.ts`) proves no call site passes a *literal*
 * language; these tests prove the resolved one actually reaches the caller,
 * handler by handler, including the error and timeout branches that only run
 * when something has already gone wrong and so are the easiest to leave in
 * English.
 *
 * French is used throughout because its voice config resolves to a distinct
 * `fr-FR` tag, so a TwiML assertion catches a wrong language even where the
 * phrase text alone might not.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ServerDependencies } from "@diegoaltoworks/chatter";
import { Hono } from "hono";
import { chat } from "./core/chat";
import { chatViaHTTP } from "./core/chatbot/client";
import {
  clearAllContexts,
  resolveLanguage,
  setDetectedLanguage,
  stopCleanup,
} from "./core/context";
import { DEFAULT_LANGUAGE } from "./core/language";
import { getChannelPhrase, getPhrase } from "./core/phrases";
import { escapeXml } from "./core/xml";
import { FlowRegistry } from "./flows/registry";
import { rateLimitMiddleware, resetRateLimitStore } from "./middleware/rate-limit";
import { callRoutes } from "./routes/call";
import { setPending } from "./routes/call/pending";
import { messagingRoutes } from "./routes/messaging";
import { handleFallback } from "./routes/shared/handle-fallback";
import type { TalkerDependencies } from "./types";

const CALLER = "+33123456789";

function createTestDeps(
  configOverrides?: Partial<TalkerDependencies["config"]>,
): TalkerDependencies {
  return {
    chatter: {} as ServerDependencies,
    config: {
      // Unsigned test traffic: no Twilio auth token in these fixtures.
      allowUnsignedWebhooks: true,
      chatFn: async (_phone, msg) => `Echo: ${msg}`,
      ...configOverrides,
    },
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
  };
}

function post(app: Hono, path: string, fields: Record<string, string>) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

function callApp(deps: TalkerDependencies): Hono {
  const app = new Hono();
  app.route("/", callRoutes(deps, new FlowRegistry("")));
  return app;
}

function messagingApp(deps: TalkerDependencies, channel: "sms" | "whatsapp"): Hono {
  const app = new Hono();
  app.route("/", messagingRoutes(deps, new FlowRegistry(""), channel));
  return app;
}

/** The French copy for a key, read the same way the handler under test does. */
const french = (key: Parameters<typeof getPhrase>[1]) => getPhrase("fr", key);

/**
 * The same copy as it appears inside TwiML. Every shipped French phrase used
 * here contains an apostrophe, which the TwiML helpers escape to `&apos;`, so
 * asserting against the raw phrase would fail for the wrong reason.
 */
const spoken = (key: Parameters<typeof getPhrase>[1]) => escapeXml(french(key));

beforeEach(() => {
  clearAllContexts();
  resetRateLimitStore();
});

afterEach(() => {
  clearAllContexts();
  stopCleanup();
  resetRateLimitStore();
});

describe("resolveLanguage", () => {
  it("falls back to the default before detection has run", () => {
    expect(resolveLanguage(CALLER)).toBe(DEFAULT_LANGUAGE);
  });

  it("returns the detected language once detection has run", () => {
    setDetectedLanguage(CALLER, "fr");
    expect(resolveLanguage(CALLER)).toBe("fr");
  });

  it("falls back to the default for a number with no context at all", () => {
    expect(resolveLanguage("+15550000000")).toBe(DEFAULT_LANGUAGE);
  });

  it("falls back to the default rather than storing a malformed code", () => {
    setDetectedLanguage(CALLER, "../../etc/passwd");
    expect(resolveLanguage(CALLER)).toBe(DEFAULT_LANGUAGE);
  });
});

describe("handleInitialCall", () => {
  // The one deliberate exception: this handler clears the context, and the
  // caller has not spoken yet, so there is nothing to detect from.
  it("greets in the default language even when a stale context named another", async () => {
    setDetectedLanguage(CALLER, "fr");
    const res = await post(callApp(createTestDeps()), "/call", { From: CALLER });

    const text = await res.text();
    expect(text).toContain('language="en-GB"');
    expect(text).toContain(escapeXml(getPhrase(DEFAULT_LANGUAGE, "greeting")));
  });
});

describe("handleRespond", () => {
  it("re-prompts in the detected language when no speech came through", async () => {
    setDetectedLanguage(CALLER, "fr");
    const res = await post(callApp(createTestDeps()), "/call/respond", { From: CALLER });

    const text = await res.text();
    expect(text).toContain(spoken("didNotCatch"));
    expect(text).toContain('language="fr-FR"');
  });

  // The branches past this one (the ack, the background failure, the
  // synchronous catch) all run processCall, which calls OpenAI directly
  // rather than through chatFn - reaching them from a route test means
  // mocking that module process-globally, which the call-route tests that
  // already do it warn is order-dependent. Their language plumbing is the
  // same `resolveLanguage` call the phrase guard checks, and `chat()`'s own
  // apology is covered below at the unit level.
});

describe("handleAnswer", () => {
  it("speaks lostQuestion in the detected language", async () => {
    setDetectedLanguage(CALLER, "fr");
    const res = await post(callApp(createTestDeps()), "/call/answer", { From: CALLER });

    const text = await res.text();
    expect(text).toContain(spoken("lostQuestion"));
    expect(text).toContain('language="fr-FR"');
  });

  it("speaks the timeout phrase in the detected language", async () => {
    setDetectedLanguage(CALLER, "fr");
    // A pending query that never resolves, against a 1ms budget.
    setPending(CALLER, {
      speechResult: "bonjour",
      promise: new Promise(() => {}),
      resolve: () => {},
    });
    const app = callApp(createTestDeps({ callAnswerBudgetMs: 1 }));

    const res = await post(app, "/call/answer", { From: CALLER });
    const text = await res.text();
    expect(text).toContain(spoken("timeout"));
    expect(text).toContain('language="fr-FR"');
  });
});

describe("handleNoSpeech", () => {
  it("retries in the detected language", async () => {
    setDetectedLanguage(CALLER, "fr");
    const res = await post(callApp(createTestDeps()), "/call/no-speech", { From: CALLER });

    const text = await res.text();
    expect(text).toContain(spoken("didNotHearRetry"));
    expect(text).toContain('language="fr-FR"');
  });
});

describe("handleIncomingMessage", () => {
  it("greets an empty message in the detected language", async () => {
    setDetectedLanguage(CALLER, "fr");
    const res = await post(messagingApp(createTestDeps(), "sms"), "/sms", {
      From: CALLER,
      Body: "   ",
    });

    expect(await res.text()).toContain(escapeXml(getChannelPhrase("sms", "fr", "greeting")));
  });
});

describe("handleFallback", () => {
  it("apologises in the detected language", async () => {
    setDetectedLanguage(CALLER, "fr");
    const deps = createTestDeps();
    const app = new Hono();
    app.post("/fallback", (c) => handleFallback(c, deps, "whatsapp"));

    const res = await post(app, "/fallback", { From: CALLER, Body: "salut" });
    expect(await res.text()).toContain(
      escapeXml(getChannelPhrase("whatsapp", "fr", "genericError")),
    );
  });
});

describe("rateLimitMiddleware", () => {
  it("says the 429 phrase in the detected language, with that language's voice", async () => {
    setDetectedLanguage(CALLER, "fr");
    const app = new Hono();
    app.use("/call/*", rateLimitMiddleware({ maxRequests: 1, windowMs: 60_000 }, {}));
    app.post("/call", (c) => c.text("ok"));

    expect((await post(app, "/call", { From: CALLER })).status).toBe(200);

    const limited = await post(app, "/call", { From: CALLER });
    expect(limited.status).toBe(429);
    const text = await limited.text();
    expect(text).toContain(spoken("rateLimited"));
    expect(text).toContain('language="fr-FR"');
    expect(text).toContain('voice="Polly.Mathieu"');
  });
});

describe("chat", () => {
  it("apologises in the detected language when a host's chatFn throws", async () => {
    setDetectedLanguage(CALLER, "fr");
    const deps = createTestDeps({
      chatFn: () => {
        throw new Error("boom");
      },
    });

    expect(await chat(deps, CALLER, "bonjour", "call")).toBe(french("chatError"));
  });

  it("apologises in the detected language when the remote chatbot is unreachable", async () => {
    setDetectedLanguage(CALLER, "fr");
    const originalFetch = global.fetch;
    global.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    try {
      const reply = await chatViaHTTP({ url: "https://example.invalid/chat" }, CALLER, "bonjour");
      expect(reply).toBe(french("chatError"));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("apologises in the detected language when the remote chatbot returns no reply", async () => {
    setDetectedLanguage(CALLER, "fr");
    const originalFetch = global.fetch;
    global.fetch = mock(
      async () => new Response(JSON.stringify({ reply: "" }), { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const reply = await chatViaHTTP({ url: "https://example.invalid/chat" }, CALLER, "bonjour");
      expect(reply).toBe(french("chatError"));
    } finally {
      global.fetch = originalFetch;
    }
  });
});

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  addMessage,
  type ContextStore,
  clearActiveFlow,
  clearAllContexts,
  clearContext,
  configureContextStore,
  createInMemoryContextStore,
  getActiveFlow,
  getContext,
  getDetectedLanguage,
  getLastPrompt,
  getMessageHistory,
  getNoSpeechRetries,
  getOrCreateContext,
  incrementNoSpeechRetries,
  resetNoSpeechRetries,
  setActiveFlow,
  setDetectedLanguage,
  setLastPrompt,
  startCleanup,
  stopCleanup,
  updateFlowParams,
} from "./context";
import { logger } from "./logger";

describe("Context Store", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  describe("getOrCreateContext", () => {
    it("should create a new context for unknown phone", () => {
      const ctx = getOrCreateContext("+1234567890");
      expect(ctx.phoneNumber).toBe("+1234567890");
      expect(ctx.channel).toBe("call");
      expect(ctx.detectedLanguage).toBeNull();
      expect(ctx.messageHistory).toEqual([]);
      expect(ctx.activeFlow).toBeNull();
      expect(ctx.noSpeechRetries).toBe(0);
    });

    it("should return existing context", () => {
      const ctx1 = getOrCreateContext("+1234567890");
      ctx1.detectedLanguage = "fr";
      const ctx2 = getOrCreateContext("+1234567890");
      expect(ctx2.detectedLanguage).toBe("fr");
    });

    it("should update lastActivity on access", () => {
      const ctx1 = getOrCreateContext("+1234567890");
      const firstActivity = ctx1.lastActivity;
      // Small delay
      const ctx2 = getOrCreateContext("+1234567890");
      expect(ctx2.lastActivity).toBeGreaterThanOrEqual(firstActivity);
    });

    it("should create with sms channel", () => {
      const ctx = getOrCreateContext("+1234567890", "sms");
      expect(ctx.channel).toBe("sms");
    });
  });

  describe("getContext", () => {
    it("should return undefined for unknown phone", () => {
      expect(getContext("+9999999999")).toBeUndefined();
    });

    it("should return existing context", () => {
      getOrCreateContext("+1234567890");
      expect(getContext("+1234567890")).toBeDefined();
    });
  });

  describe("language detection", () => {
    it("should set language once (first detection wins)", () => {
      setDetectedLanguage("+1234567890", "fr");
      setDetectedLanguage("+1234567890", "de");
      expect(getDetectedLanguage("+1234567890")).toBe("fr");
    });

    it("should return null for unknown phone", () => {
      expect(getDetectedLanguage("+9999999999")).toBeNull();
    });

    it("should not store a malformed language code", () => {
      for (const bad of ["constructor", "__proto__", "../package", "en.json", "EN"]) {
        setDetectedLanguage("+1234567890", bad);
        expect(getDetectedLanguage("+1234567890")).toBeNull();
      }
    });

    it("should leave the slot open for a later valid detection", () => {
      setDetectedLanguage("+1234567890", "../package");
      setDetectedLanguage("+1234567890", "fr");
      expect(getDetectedLanguage("+1234567890")).toBe("fr");
    });

    it("should accept a code with a region subtag", () => {
      setDetectedLanguage("+1234567890", "pt-BR");
      expect(getDetectedLanguage("+1234567890")).toBe("pt-BR");
    });
  });

  describe("message history", () => {
    it("should add and retrieve messages", () => {
      addMessage("+1234567890", "user", "hello");
      addMessage("+1234567890", "assistant", "hi there");
      const history = getMessageHistory("+1234567890");
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("hello");
      expect(history[1].role).toBe("assistant");
    });

    it("should trim to last 10 messages", () => {
      for (let i = 0; i < 15; i++) {
        addMessage("+1234567890", "user", `msg ${i}`);
      }
      const history = getMessageHistory("+1234567890");
      expect(history).toHaveLength(10);
      expect(history[0].content).toBe("msg 5");
      expect(history[9].content).toBe("msg 14");
    });

    it("should return empty array for unknown phone", () => {
      expect(getMessageHistory("+9999999999")).toEqual([]);
    });
  });

  describe("flow state", () => {
    it("should manage active flow lifecycle", () => {
      getOrCreateContext("+1234567890");
      expect(getActiveFlow("+1234567890")).toBeNull();

      setActiveFlow("+1234567890", "testFlow", { param1: "value1" });
      const flow = getActiveFlow("+1234567890");
      expect(flow?.flowName).toBe("testFlow");
      expect(flow?.params).toEqual({ param1: "value1" });
      expect(flow?.attempts).toBe(0);

      updateFlowParams("+1234567890", { param2: "value2" });
      const updated = getActiveFlow("+1234567890");
      expect(updated?.params).toEqual({ param1: "value1", param2: "value2" });
      expect(updated?.attempts).toBe(1);

      clearActiveFlow("+1234567890");
      expect(getActiveFlow("+1234567890")).toBeNull();
    });
  });

  describe("no-speech retries", () => {
    it("should increment and reset retries", () => {
      getOrCreateContext("+1234567890");
      expect(getNoSpeechRetries("+1234567890")).toBe(0);

      expect(incrementNoSpeechRetries("+1234567890")).toBe(1);
      expect(incrementNoSpeechRetries("+1234567890")).toBe(2);
      expect(getNoSpeechRetries("+1234567890")).toBe(2);

      resetNoSpeechRetries("+1234567890");
      expect(getNoSpeechRetries("+1234567890")).toBe(0);
    });
  });

  describe("last prompt", () => {
    it("should store and retrieve last prompt", () => {
      expect(getLastPrompt("+1234567890")).toBeNull();
      setLastPrompt("+1234567890", "What is your question?");
      expect(getLastPrompt("+1234567890")).toBe("What is your question?");
    });
  });

  describe("clearContext", () => {
    it("should remove context entirely", () => {
      getOrCreateContext("+1234567890");
      addMessage("+1234567890", "user", "hello");
      setDetectedLanguage("+1234567890", "fr");

      clearContext("+1234567890");
      expect(getContext("+1234567890")).toBeUndefined();
      expect(getDetectedLanguage("+1234567890")).toBeNull();
      expect(getMessageHistory("+1234567890")).toEqual([]);
    });
  });

  describe("startCleanup", () => {
    it("should invoke onTick on every sweep so other stores can share the timer", async () => {
      stopCleanup(); // startCleanup no-ops if a timer from another test is still running
      let ticks = 0;
      startCleanup(1000, 5, () => {
        ticks += 1;
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(ticks).toBeGreaterThan(0);
    });

    it("should unref the interval so it never keeps the process alive on its own", () => {
      stopCleanup();
      const originalSetInterval = globalThis.setInterval;
      let unrefCalled = false;
      globalThis.setInterval = ((fn: (...args: unknown[]) => void, ms?: number) => {
        const timer = originalSetInterval(fn, ms);
        const originalUnref = timer.unref?.bind(timer);
        timer.unref = () => {
          unrefCalled = true;
          return originalUnref?.() ?? timer;
        };
        return timer;
      }) as typeof setInterval;

      try {
        startCleanup(1000, 5);
        expect(unrefCalled).toBe(true);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    it("should warn and keep the first mount's config on a second call with a different interval", async () => {
      stopCleanup();
      const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
      let firstTicks = 0;
      try {
        startCleanup(1000, 5, () => {
          firstTicks += 1;
        });

        startCleanup(2000, 9999);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [, data] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
        expect(data.active).toEqual({ ttlMs: 1000, intervalMs: 5 });
        expect(data.ignored).toMatchObject({ ttlMs: 2000, intervalMs: 9999 });

        // The second call's 9999ms interval did not replace the first's 5ms
        // one - onTick keeps firing on the original cadence.
        await new Promise((r) => setTimeout(r, 20));
        expect(firstTicks).toBeGreaterThan(0);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should warn on a second call even with the same ttl/interval, since its onTick is dropped", () => {
      stopCleanup();
      const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
      try {
        startCleanup(1000, 5);
        startCleanup(1000, 5, () => {});

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [, data] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
        expect((data.ignored as { hasOnTick: boolean }).hasOnTick).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should not warn on a second call with identical config and no onTick", () => {
      stopCleanup();
      const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
      try {
        startCleanup(1000, 5);
        startCleanup(1000, 5);

        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("configureContextStore", () => {
    afterEach(() => {
      // Every other test in this file relies on the default in-memory
      // store; restore it so a store swapped in here doesn't leak.
      configureContextStore(createInMemoryContextStore());
    });

    it("routes reads and writes through an injected store instead of the built-in Map", () => {
      const backing = new Map<string, ReturnType<typeof getOrCreateContext>>();
      const fakeStore: ContextStore = {
        get: (phoneNumber) => backing.get(phoneNumber),
        set: (phoneNumber, context) => backing.set(phoneNumber, context),
        delete: (phoneNumber) => backing.delete(phoneNumber),
        clear: () => backing.clear(),
        entries: () => backing.entries(),
      };
      configureContextStore(fakeStore);

      const ctx = getOrCreateContext("+1234567890");
      expect(backing.has("+1234567890")).toBe(true);
      expect(getContext("+1234567890")).toBe(ctx);

      clearContext("+1234567890");
      expect(backing.has("+1234567890")).toBe(false);
    });

    it("sweeps stale entries from an injected store on cleanup, same as the default Map", async () => {
      stopCleanup();
      const backing = new Map<string, ReturnType<typeof getOrCreateContext>>();
      const fakeStore: ContextStore = {
        get: (phoneNumber) => backing.get(phoneNumber),
        set: (phoneNumber, context) => backing.set(phoneNumber, context),
        delete: (phoneNumber) => backing.delete(phoneNumber),
        clear: () => backing.clear(),
        entries: () => backing.entries(),
      };
      configureContextStore(fakeStore);

      const ctx = getOrCreateContext("+1234567890");
      ctx.lastActivity = Date.now() - 10_000;

      startCleanup(50, 5);
      await new Promise((r) => setTimeout(r, 20));

      expect(backing.has("+1234567890")).toBe(false);
    });

    it("leaves entries already in a previous store unreachable after a second configure call", () => {
      const firstStore = createInMemoryContextStore();
      configureContextStore(firstStore);
      getOrCreateContext("+1234567890");
      expect(getContext("+1234567890")).toBeDefined();

      configureContextStore(createInMemoryContextStore());
      expect(getContext("+1234567890")).toBeUndefined();
    });
  });
});

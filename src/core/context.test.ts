import { afterEach, describe, expect, it } from "bun:test";
import {
  addMessage,
  clearActiveFlow,
  clearAllContexts,
  clearContext,
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
  stopCleanup,
  updateFlowParams,
} from "./context";

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
});

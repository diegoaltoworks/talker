import { describe, expect, it } from "bun:test";
import { getExitMessage, shouldExitFlow } from "./utils";

describe("Flow Utils", () => {
  describe("shouldExitFlow", () => {
    it("should detect cancellation keywords", () => {
      expect(shouldExitFlow("cancel")).toBe(true);
      expect(shouldExitFlow("I want to cancel")).toBe(true);
      expect(shouldExitFlow("nevermind")).toBe(true);
      expect(shouldExitFlow("stop")).toBe(true);
      expect(shouldExitFlow("forget it")).toBe(true);
      expect(shouldExitFlow("quit")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(shouldExitFlow("CANCEL")).toBe(true);
      expect(shouldExitFlow("Nevermind")).toBe(true);
    });

    it("should not match non-cancellation messages", () => {
      expect(shouldExitFlow("hello")).toBe(false);
      expect(shouldExitFlow("what is your name")).toBe(false);
      expect(shouldExitFlow("tell me more")).toBe(false);
    });
  });

  describe("getExitMessage", () => {
    it("should return English exit message", () => {
      const msg = getExitMessage("en");
      expect(msg).toContain("cancelled");
    });

    it("should return message for other languages", () => {
      const frMsg = getExitMessage("fr");
      expect(frMsg).toBeDefined();
      expect(frMsg.length).toBeGreaterThan(0);
    });
  });
});

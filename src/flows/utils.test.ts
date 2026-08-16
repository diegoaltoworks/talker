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

    it("should not false-positive on words that merely contain a keyword", () => {
      expect(shouldExitFlow("quite good, thanks")).toBe(false);
      expect(shouldExitFlow("it's a nonstop flight")).toBe(false);
      expect(shouldExitFlow("my flight has a stopover")).toBe(false);
    });

    it("should still match a keyword at the start or end of the message", () => {
      expect(shouldExitFlow("cancel please")).toBe(true);
      expect(shouldExitFlow("please cancel")).toBe(true);
    });

    it("should match the two-word 'never mind' phrase", () => {
      expect(shouldExitFlow("never mind")).toBe(true);
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

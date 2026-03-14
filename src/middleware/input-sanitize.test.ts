import { describe, expect, it } from "bun:test";
import { truncateInput } from "./input-sanitize";

describe("Input Sanitization", () => {
  describe("truncateInput", () => {
    it("should return the input unchanged if under the limit", () => {
      expect(truncateInput("hello", 100)).toBe("hello");
    });

    it("should return the input unchanged if exactly at the limit", () => {
      const input = "a".repeat(100);
      expect(truncateInput(input, 100)).toBe(input);
    });

    it("should truncate input that exceeds the limit", () => {
      const input = "a".repeat(150);
      const result = truncateInput(input, 100);
      expect(result.length).toBe(100);
      expect(result).toBe("a".repeat(100));
    });

    it("should handle empty string", () => {
      expect(truncateInput("", 100)).toBe("");
    });

    it("should handle a limit of 0", () => {
      expect(truncateInput("hello", 0)).toBe("");
    });

    it("should handle unicode characters", () => {
      const input = "héllo wörld café";
      expect(truncateInput(input, 5)).toBe("héllo");
    });

    it("should truncate a very long input to the default-like limit", () => {
      const longInput = "x".repeat(5000);
      const result = truncateInput(longInput, 1000);
      expect(result.length).toBe(1000);
    });
  });
});

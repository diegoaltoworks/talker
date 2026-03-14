import { describe, expect, it } from "bun:test";
import { redactPhone } from "./logger";

describe("Logger", () => {
  describe("redactPhone", () => {
    it("should redact a full phone number keeping last 4 digits", () => {
      expect(redactPhone("+15551234567")).toBe("***4567");
    });

    it("should redact a phone number without country code", () => {
      expect(redactPhone("5551234567")).toBe("***4567");
    });

    it("should handle a phone with formatting", () => {
      expect(redactPhone("+1 (555) 123-4567")).toBe("***4567");
    });

    it("should return 'unknown' unchanged", () => {
      expect(redactPhone("unknown")).toBe("unknown");
    });

    it("should return empty string unchanged", () => {
      expect(redactPhone("")).toBe("");
    });

    it("should redact short numbers to just ***", () => {
      expect(redactPhone("1234")).toBe("***");
    });

    it("should handle 5-digit numbers", () => {
      expect(redactPhone("12345")).toBe("***2345");
    });
  });
});

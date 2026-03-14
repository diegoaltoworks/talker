import { afterEach, describe, expect, it } from "bun:test";
import { checkRateLimit, resetRateLimitStore } from "./rate-limit";

describe("Rate Limiting", () => {
  afterEach(() => {
    resetRateLimitStore();
  });

  describe("checkRateLimit", () => {
    it("should allow requests under the limit", () => {
      expect(checkRateLimit("+15551234567", 5, 60000)).toBe(true);
      expect(checkRateLimit("+15551234567", 5, 60000)).toBe(true);
      expect(checkRateLimit("+15551234567", 5, 60000)).toBe(true);
    });

    it("should reject requests over the limit", () => {
      const phone = "+15551234567";
      for (let i = 0; i < 3; i++) {
        expect(checkRateLimit(phone, 3, 60000)).toBe(true);
      }
      // 4th request should be rejected
      expect(checkRateLimit(phone, 3, 60000)).toBe(false);
    });

    it("should track different phone numbers independently", () => {
      const phone1 = "+15551111111";
      const phone2 = "+15552222222";

      for (let i = 0; i < 3; i++) {
        checkRateLimit(phone1, 3, 60000);
      }

      // phone1 is at the limit
      expect(checkRateLimit(phone1, 3, 60000)).toBe(false);
      // phone2 should still be allowed
      expect(checkRateLimit(phone2, 3, 60000)).toBe(true);
    });

    it("should allow requests after the window expires", () => {
      const phone = "+15551234567";
      // Use a very short window (1ms)
      for (let i = 0; i < 3; i++) {
        checkRateLimit(phone, 3, 1);
      }

      // Wait for the window to expire
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      // Should be allowed again
      expect(checkRateLimit(phone, 3, 1)).toBe(true);
    });

    it("should handle a limit of 1", () => {
      expect(checkRateLimit("+15551234567", 1, 60000)).toBe(true);
      expect(checkRateLimit("+15551234567", 1, 60000)).toBe(false);
    });
  });
});

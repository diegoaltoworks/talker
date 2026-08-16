import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { logger } from "../core/logger";
import {
  checkRateLimit,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_MS,
  rateLimitMiddleware,
  resetRateLimitStore,
  stopRateLimitCleanup,
} from "./rate-limit";

describe("Rate Limiting", () => {
  afterEach(() => {
    resetRateLimitStore();
  });

  it("pins the default max requests and window", () => {
    expect(DEFAULT_MAX_REQUESTS).toBe(30);
    expect(DEFAULT_WINDOW_MS).toBe(60_000);
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

  describe("cleanup timer", () => {
    it("should unref the interval so it never keeps the process alive on its own", () => {
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
        rateLimitMiddleware({ windowMs: 60000 });
        expect(unrefCalled).toBe(true);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    it("stopRateLimitCleanup should stop the timer without clearing tracked counts", () => {
      rateLimitMiddleware({ windowMs: 60000 });
      checkRateLimit("+15559998888", 3, 60000);
      checkRateLimit("+15559998888", 3, 60000);

      stopRateLimitCleanup();

      // Counts survive - only the timer is gone, unlike resetRateLimitStore.
      expect(checkRateLimit("+15559998888", 3, 60000)).toBe(true);
      expect(checkRateLimit("+15559998888", 3, 60000)).toBe(false);
    });

    it("should warn and keep the first mount's windowMs on a second mount with a different one", () => {
      const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
      try {
        rateLimitMiddleware({ windowMs: 60000 });
        rateLimitMiddleware({ windowMs: 1 });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [, data] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
        expect(data.active).toBe(60000);
        expect(data.ignored).toBe(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should not warn on a second mount with the same windowMs", () => {
      const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
      try {
        rateLimitMiddleware({ windowMs: 60000 });
        rateLimitMiddleware({ windowMs: 60000 });

        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

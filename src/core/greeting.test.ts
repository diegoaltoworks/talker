/**
 * Greeting Resolution Tests
 */

import { describe, expect, it, spyOn } from "bun:test";
import type { TalkerConfig } from "../types";
import { resolveGreeting } from "./greeting";
import { logger } from "./logger";

describe("resolveGreeting", () => {
  it("returns null when greetingFn is not configured", async () => {
    const result = await resolveGreeting({}, "+15551234567", "call");
    expect(result).toBeNull();
  });

  it("returns the greeting produced by greetingFn", async () => {
    const config: TalkerConfig = { greetingFn: () => "Hey there!" };
    const result = await resolveGreeting(config, "+15551234567", "call");
    expect(result).toBe("Hey there!");
  });

  it("returns null when greetingFn resolves to null/undefined", async () => {
    const config: TalkerConfig = { greetingFn: () => null };
    const result = await resolveGreeting(config, "+15551234567", "sms");
    expect(result).toBeNull();
  });

  it("falls back to null and logs the error message when greetingFn throws", async () => {
    const config: TalkerConfig = {
      greetingFn: () => {
        throw new Error("greeting backend unavailable");
      },
    };
    const errorSpy = spyOn(logger, "error").mockImplementation(() => {});
    try {
      const result = await resolveGreeting(config, "+15551234567", "whatsapp");
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, data] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(data.error).toBe("greeting backend unavailable");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

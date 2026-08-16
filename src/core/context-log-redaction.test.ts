/**
 * Regression test for the phone-number redaction bypass: several context.ts
 * log calls used to interpolate the raw phone number straight into the
 * message string, which `logger`'s field-based redaction (redacts values
 * under keys named "phoneNumber"/"phone") never sees.
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  clearActiveFlow,
  clearAllContexts,
  getContext,
  getOrCreateContext,
  setActiveFlow,
  setDetectedLanguage,
  startCleanup,
  stopCleanup,
} from "./context";
import { logger } from "./logger";

const PHONE = "+15551234567";

describe("context.ts log messages never embed a raw phone number", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  function assertNoLeak(info: ReturnType<typeof spyOn>) {
    expect(info.mock.calls.length).toBeGreaterThan(0);
    for (const call of info.mock.calls) {
      const message = call[0] as string;
      expect(message).not.toContain(PHONE);
      expect(message).not.toContain("15551234567");
    }
  }

  it("context created", () => {
    const info = spyOn(logger, "info");
    try {
      getOrCreateContext(PHONE, "sms");
      assertNoLeak(info);
      expect(info.mock.calls[0]?.[1]).toEqual({ phoneNumber: PHONE, channel: "sms" });
    } finally {
      info.mockRestore();
    }
  });

  it("detected language", () => {
    getOrCreateContext(PHONE);
    const info = spyOn(logger, "info");
    try {
      setDetectedLanguage(PHONE, "fr");
      assertNoLeak(info);
      expect(info.mock.calls[0]?.[1]).toEqual({ phoneNumber: PHONE, language: "fr" });
    } finally {
      info.mockRestore();
    }
  });

  it("flow activated and cleared", () => {
    getOrCreateContext(PHONE);
    const info = spyOn(logger, "info");
    try {
      setActiveFlow(PHONE, "addNumbers");
      clearActiveFlow(PHONE);
      assertNoLeak(info);
    } finally {
      info.mockRestore();
    }
  });

  it("context expired (cleanup sweep)", async () => {
    getOrCreateContext(PHONE);
    const context = getContext(PHONE);
    if (context) context.lastActivity = Date.now() - 1000;

    const info = spyOn(logger, "info");
    try {
      startCleanup(500, 10);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assertNoLeak(info);
    } finally {
      info.mockRestore();
    }
  });
});

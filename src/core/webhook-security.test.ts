import { describe, expect, it, spyOn } from "bun:test";
import { logger } from "./logger";
import { assertWebhookSecurity } from "./webhook-security";

describe("assertWebhookSecurity", () => {
  it("should allow mounting when an auth token is configured", () => {
    expect(() => assertWebhookSecurity({ twilio: { authToken: "token" } })).not.toThrow();
  });

  it("should refuse to mount when no auth token is configured", () => {
    expect(() => assertWebhookSecurity({})).toThrow(/Twilio auth token missing/);
  });

  it("should refuse to mount when twilio config exists without an auth token", () => {
    expect(() => assertWebhookSecurity({ twilio: { accountSid: "AC123" } })).toThrow(
      /allowUnsignedWebhooks/,
    );
  });

  it("should allow mounting unsigned only behind the explicit flag", () => {
    expect(() => assertWebhookSecurity({ allowUnsignedWebhooks: true })).not.toThrow();
  });

  it("should warn loudly when mounting unsigned — the warning is the only safety net", () => {
    const warn = spyOn(logger, "warn");
    try {
      assertWebhookSecurity({ allowUnsignedWebhooks: true });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("without Twilio signature validation");
    } finally {
      warn.mockRestore();
    }
  });

  it("should prefer a configured auth token over the unsigned flag", () => {
    const warn = spyOn(logger, "warn");
    try {
      expect(() =>
        assertWebhookSecurity({ twilio: { authToken: "token" }, allowUnsignedWebhooks: true }),
      ).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

import { describe, expect, it } from "bun:test";
import { computeTwilioSignature, validateTwilioSignature } from "./twilio-signature";

describe("Twilio Signature Validation", () => {
  const authToken = "test-auth-token-12345";
  const url = "https://example.com/call";

  describe("computeTwilioSignature", () => {
    it("should produce a base64-encoded HMAC-SHA1 signature", () => {
      const sig = computeTwilioSignature(authToken, url, { From: "+15551234567" });
      expect(typeof sig).toBe("string");
      expect(sig.length).toBeGreaterThan(0);
      // Base64 pattern
      expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("should sort params alphabetically before signing", () => {
      const sig1 = computeTwilioSignature(authToken, url, {
        From: "+15551234567",
        Body: "hello",
      });
      const sig2 = computeTwilioSignature(authToken, url, {
        Body: "hello",
        From: "+15551234567",
      });
      expect(sig1).toBe(sig2);
    });

    it("should produce different signatures for different params", () => {
      const sig1 = computeTwilioSignature(authToken, url, { From: "+15551234567" });
      const sig2 = computeTwilioSignature(authToken, url, { From: "+15559999999" });
      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different auth tokens", () => {
      const sig1 = computeTwilioSignature("token-a", url, { From: "+15551234567" });
      const sig2 = computeTwilioSignature("token-b", url, { From: "+15551234567" });
      expect(sig1).not.toBe(sig2);
    });

    it("should handle empty params", () => {
      const sig = computeTwilioSignature(authToken, url, {});
      expect(typeof sig).toBe("string");
      expect(sig.length).toBeGreaterThan(0);
    });
  });

  describe("validateTwilioSignature", () => {
    it("should return true for a valid signature", () => {
      const params = { From: "+15551234567", Body: "hello" };
      const sig = computeTwilioSignature(authToken, url, params);
      expect(validateTwilioSignature(authToken, sig, url, params)).toBe(true);
    });

    it("should return false for an invalid signature", () => {
      const params = { From: "+15551234567" };
      expect(validateTwilioSignature(authToken, "invalid-sig", url, params)).toBe(false);
    });

    it("should return false for a tampered parameter", () => {
      const params = { From: "+15551234567" };
      const sig = computeTwilioSignature(authToken, url, params);
      const tampered = { From: "+15559999999" };
      expect(validateTwilioSignature(authToken, sig, url, tampered)).toBe(false);
    });

    it("should return false for a different URL", () => {
      const params = { From: "+15551234567" };
      const sig = computeTwilioSignature(authToken, url, params);
      expect(validateTwilioSignature(authToken, sig, "https://evil.com/call", params)).toBe(false);
    });

    it("should return false for a wrong auth token", () => {
      const params = { From: "+15551234567" };
      const sig = computeTwilioSignature(authToken, url, params);
      expect(validateTwilioSignature("wrong-token", sig, url, params)).toBe(false);
    });
  });
});

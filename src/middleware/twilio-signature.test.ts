import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  computeTwilioSignature,
  signedRequestUrl,
  twilioSignatureMiddleware,
  validateTwilioSignature,
} from "./twilio-signature";

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

  describe("signedRequestUrl", () => {
    it("should use the request URL as-is when no base URL is configured", () => {
      expect(signedRequestUrl("http://localhost/sms?tenant=acme", "/sms")).toBe(
        "http://localhost/sms?tenant=acme",
      );
    });

    it("should preserve the query string when a base URL is configured", () => {
      expect(
        signedRequestUrl(
          "http://localhost/sms?tenant=acme&lang=fr",
          "/sms",
          "https://bot.example.com",
        ),
      ).toBe("https://bot.example.com/sms?tenant=acme&lang=fr");
    });

    it("should not append a question mark when there is no query string", () => {
      expect(signedRequestUrl("http://localhost/sms", "/sms", "https://bot.example.com")).toBe(
        "https://bot.example.com/sms",
      );
    });

    it("should strip a trailing slash from the base URL", () => {
      expect(signedRequestUrl("http://localhost/sms", "/sms", "https://bot.example.com/")).toBe(
        "https://bot.example.com/sms",
      );
    });
  });

  describe("twilioSignatureMiddleware", () => {
    const params = { Body: "hello", From: "+15551234567" };

    function createApp(token?: string, baseUrl?: string, options?: { allowUnsigned?: boolean }) {
      const app = new Hono();
      app.post("/sms", twilioSignatureMiddleware(token, baseUrl, options));
      app.post("/sms", (c) => c.text("handled"));
      return app;
    }

    function post(app: Hono, path: string, signature?: string) {
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (signature) headers["x-twilio-signature"] = signature;
      return app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers,
          body: new URLSearchParams(params).toString(),
        }),
      );
    }

    it("should reject every request when no auth token is configured", async () => {
      const res = await post(createApp(undefined), "/sms");
      expect(res.status).toBe(403);
    });

    it("should reject signed requests when no token is configured", async () => {
      const sig = computeTwilioSignature(authToken, "http://localhost/sms", params);
      const res = await post(createApp(undefined), "/sms", sig);
      expect(res.status).toBe(403);
    });

    it("should pass through without a token only when allowUnsigned is set", async () => {
      const res = await post(createApp(undefined, undefined, { allowUnsigned: true }), "/sms");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("handled");
    });

    it("should reject a request with no signature header", async () => {
      const res = await post(createApp(authToken), "/sms");
      expect(res.status).toBe(403);
    });

    it("should accept a correctly signed request", async () => {
      const sig = computeTwilioSignature(authToken, "http://localhost/sms", params);
      const res = await post(createApp(authToken), "/sms", sig);
      expect(res.status).toBe(200);
    });

    it("should validate a query-string webhook against the configured public URL", async () => {
      const signed = computeTwilioSignature(
        authToken,
        "https://bot.example.com/sms?tenant=acme",
        params,
      );
      const res = await post(
        createApp(authToken, "https://bot.example.com"),
        "/sms?tenant=acme",
        signed,
      );
      expect(res.status).toBe(200);
    });

    it("should reject when the query string is not the one Twilio signed", async () => {
      const signed = computeTwilioSignature(
        authToken,
        "https://bot.example.com/sms?tenant=acme",
        params,
      );
      const res = await post(
        createApp(authToken, "https://bot.example.com"),
        "/sms?tenant=evil",
        signed,
      );
      expect(res.status).toBe(403);
    });
  });
});

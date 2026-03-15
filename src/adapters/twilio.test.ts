/**
 * Twilio Adapter Tests
 *
 * Tests for sendSMS, sendWhatsApp, and stripWhatsAppPrefix.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { TwilioConfig } from "../types";
import { sendSMS, sendWhatsApp, stripWhatsAppPrefix } from "./twilio";

const validConfig: TwilioConfig = {
  accountSid: "ACtest123",
  authToken: "auth-token-456",
  phoneNumber: "+15550001111",
};

describe("stripWhatsAppPrefix", () => {
  it("should strip whatsapp: prefix from phone number", () => {
    expect(stripWhatsAppPrefix("whatsapp:+1234567890")).toBe("+1234567890");
  });

  it("should return bare phone number unchanged", () => {
    expect(stripWhatsAppPrefix("+1234567890")).toBe("+1234567890");
  });

  it("should handle whatsapp: prefix with no number", () => {
    expect(stripWhatsAppPrefix("whatsapp:")).toBe("");
  });

  it("should not strip whatsapp from the middle of a string", () => {
    expect(stripWhatsAppPrefix("+1234whatsapp:567")).toBe("+1234whatsapp:567");
  });

  it("should handle empty string", () => {
    expect(stripWhatsAppPrefix("")).toBe("");
  });
});

describe("sendSMS", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return false when accountSid is missing", async () => {
    const config: TwilioConfig = { authToken: "token", phoneNumber: "+1234" };
    const result = await sendSMS(config, "+9876", "Hello");
    expect(result).toBe(false);
  });

  it("should return false when authToken is missing", async () => {
    const config: TwilioConfig = { accountSid: "AC123", phoneNumber: "+1234" };
    const result = await sendSMS(config, "+9876", "Hello");
    expect(result).toBe(false);
  });

  it("should return false when phoneNumber is missing", async () => {
    const config: TwilioConfig = { accountSid: "AC123", authToken: "token" };
    const result = await sendSMS(config, "+9876", "Hello");
    expect(result).toBe(false);
  });

  it("should send SMS with correct Twilio API parameters", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedInit = init;
      return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 });
    }) as unknown as typeof fetch;

    const result = await sendSMS(validConfig, "+9876543210", "Hello World");

    expect(result).toBe(true);
    expect(capturedUrl).toContain("ACtest123");
    expect(capturedUrl).toContain("Messages.json");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toHaveProperty("Authorization");

    const body = capturedInit?.body?.toString() || "";
    expect(body).toContain("From=%2B15550001111");
    expect(body).toContain("To=%2B9876543210");
    expect(body).toContain("Body=Hello+World");
  });

  it("should use Basic auth with accountSid and authToken", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 });
    }) as unknown as typeof fetch;

    await sendSMS(validConfig, "+9876", "Test");

    const expectedAuth = Buffer.from("ACtest123:auth-token-456").toString("base64");
    expect(capturedHeaders.Authorization).toBe(`Basic ${expectedAuth}`);
  });

  it("should return false on API error response", async () => {
    global.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const result = await sendSMS(validConfig, "+9876", "Hello");
    expect(result).toBe(false);
  });

  it("should return false on network error", async () => {
    global.fetch = mock(async () => {
      throw new Error("Network failure");
    }) as unknown as typeof fetch;

    const result = await sendSMS(validConfig, "+9876", "Hello");
    expect(result).toBe(false);
  });
});

describe("sendWhatsApp", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return false when credentials are missing", async () => {
    const config: TwilioConfig = {};
    const result = await sendWhatsApp(config, "+9876", "Hello");
    expect(result).toBe(false);
  });

  it("should add whatsapp: prefix to bare To and From numbers", async () => {
    let capturedBody = "";

    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || "";
      return new Response(JSON.stringify({ sid: "SM456" }), { status: 201 });
    }) as unknown as typeof fetch;

    const result = await sendWhatsApp(validConfig, "+9876543210", "Hello WhatsApp");

    expect(result).toBe(true);
    expect(capturedBody).toContain("From=whatsapp%3A%2B15550001111");
    expect(capturedBody).toContain("To=whatsapp%3A%2B9876543210");
    expect(capturedBody).toContain("Body=Hello+WhatsApp");
  });

  it("should not double-prefix when To already has whatsapp:", async () => {
    let capturedBody = "";

    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || "";
      return new Response(JSON.stringify({ sid: "SM789" }), { status: 201 });
    }) as unknown as typeof fetch;

    await sendWhatsApp(validConfig, "whatsapp:+9876543210", "Test");

    expect(capturedBody).toContain("To=whatsapp%3A%2B9876543210");
    // Should not contain double prefix
    expect(capturedBody).not.toContain("whatsapp%3Awhatsapp");
  });

  it("should not double-prefix when config.phoneNumber already has whatsapp:", async () => {
    let capturedBody = "";

    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || "";
      return new Response(JSON.stringify({ sid: "SM012" }), { status: 201 });
    }) as unknown as typeof fetch;

    const configWithPrefix: TwilioConfig = {
      ...validConfig,
      phoneNumber: "whatsapp:+15550001111",
    };
    await sendWhatsApp(configWithPrefix, "+9876543210", "Test");

    expect(capturedBody).toContain("From=whatsapp%3A%2B15550001111");
    expect(capturedBody).not.toContain("whatsapp%3Awhatsapp");
  });

  it("should return false on API error response", async () => {
    global.fetch = mock(async () => {
      return new Response("Forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    const result = await sendWhatsApp(validConfig, "+9876", "Hello");
    expect(result).toBe(false);
  });

  it("should return false on network error", async () => {
    global.fetch = mock(async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    const result = await sendWhatsApp(validConfig, "+9876", "Hello");
    expect(result).toBe(false);
  });
});

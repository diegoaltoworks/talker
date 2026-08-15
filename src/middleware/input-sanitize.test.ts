import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { getSanitizedBody, inputSanitizeMiddleware, truncateInput } from "./input-sanitize";

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

  describe("inputSanitizeMiddleware + getSanitizedBody", () => {
    function appWithLimit(maxLen: number) {
      const app = new Hono();
      app.use("*", inputSanitizeMiddleware(maxLen));
      app.post("/", async (c) => {
        const body = await getSanitizedBody(c);
        return c.json({ SpeechResult: body.SpeechResult, Body: body.Body });
      });
      return app;
    }

    function post(app: Hono, fields: Record<string, string>) {
      return app.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields).toString(),
        }),
      );
    }

    it("clamps an oversized SpeechResult at the handler", async () => {
      const app = appWithLimit(10);
      const res = await post(app, { SpeechResult: "a".repeat(50) });
      const json = await res.json();

      expect(json.SpeechResult).toBe("a".repeat(10));
    });

    it("clamps an oversized Body at the handler", async () => {
      const app = appWithLimit(10);
      const res = await post(app, { Body: "b".repeat(50) });
      const json = await res.json();

      expect(json.Body).toBe("b".repeat(10));
    });

    it("leaves input under the limit untouched", async () => {
      const app = appWithLimit(1000);
      const res = await post(app, { SpeechResult: "short message" });
      const json = await res.json();

      expect(json.SpeechResult).toBe("short message");
    });

    it("falls back to a direct parse when the middleware hasn't run", async () => {
      const app = new Hono();
      app.post("/", async (c) => {
        const body = await getSanitizedBody(c);
        return c.json({ SpeechResult: body.SpeechResult });
      });

      const res = await post(app, { SpeechResult: "hello" });
      const json = await res.json();

      expect(json.SpeechResult).toBe("hello");
    });
  });
});

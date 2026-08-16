import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { getSanitizedBody, inputSanitizeMiddleware } from "./input-sanitize";

// Grapheme-safe truncation itself is tested against `truncateGraphemeSafe`
// directly in core/text.test.ts, the function this middleware delegates to.
describe("Input Sanitization", () => {
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

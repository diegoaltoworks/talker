import { afterEach, describe, expect, it } from "bun:test";
import type { TalkerConfig } from "../types";
import { clearAllContexts, getLastPrompt, stopCleanup } from "./context";
import {
  acknowledgmentTwiml,
  farewellTwiml,
  gatherTwiml,
  messageTwiml,
  sayTwiml,
  transferTwiml,
} from "./twiml";

const baseConfig: TalkerConfig = {
  transferNumber: "+441234567890",
};

describe("TwiML Generation", () => {
  afterEach(() => {
    clearAllContexts();
    stopCleanup();
  });

  describe("gatherTwiml", () => {
    it("should generate valid TwiML with speech gather", () => {
      const result = gatherTwiml("Hello there", "en", baseConfig);
      expect(result).toContain('<?xml version="1.0"');
      expect(result).toContain("<Response>");
      expect(result).toContain('<Say voice="Polly.Brian" language="en-GB">Hello there</Say>');
      expect(result).toContain('<Gather input="speech"');
      expect(result).toContain('action="/call/respond"');
      expect(result).toContain('<Redirect method="POST">/call/no-speech</Redirect>');
      // Say nested inside Gather so speech recognition starts immediately
      // (barge-in), instead of the caller having to wait out the prompt.
      expect(result).toMatch(/<Gather[^>]*>\s*<Say/);
    });

    it("should use correct voice for language", () => {
      const result = gatherTwiml("Bonjour", "fr", baseConfig);
      expect(result).toContain('voice="Polly.Mathieu"');
      expect(result).toContain('language="fr-FR"');
    });

    it("should use route prefix when configured", () => {
      const config: TalkerConfig = { ...baseConfig, routePrefix: "/tel" };
      const result = gatherTwiml("Hello", "en", config);
      expect(result).toContain('action="/tel/call/respond"');
      expect(result).toContain("/tel/call/no-speech");
    });
  });

  describe("sayTwiml", () => {
    it("should generate simple say TwiML", () => {
      const result = sayTwiml("Goodbye", "en", baseConfig);
      expect(result).toContain("<Response>");
      expect(result).toContain('<Say voice="Polly.Brian"');
      expect(result).toContain("Goodbye</Say>");
      expect(result).not.toContain("<Gather");
    });
  });

  describe("transferTwiml", () => {
    it("should generate transfer TwiML with dial", () => {
      const result = transferTwiml("en", baseConfig);
      expect(result).toContain("<Dial>+441234567890</Dial>");
      expect(result).toContain("<Say");
    });

    it("should use a caller-supplied message verbatim instead of re-resolving the phrase", () => {
      // A rotating phrase entry would otherwise be re-picked on a second lookup,
      // so a caller that already resolved the message (e.g. to tap it) must see
      // that exact text in the TwiML, not a different random variant.
      const result = transferTwiml("en", baseConfig, "Caller-supplied transfer message");
      expect(result).toContain("Caller-supplied transfer message</Say>");
    });
  });

  describe("acknowledgmentTwiml", () => {
    it("should generate acknowledgment with redirect to answer", () => {
      const result = acknowledgmentTwiml("en", baseConfig);
      expect(result).toContain('<Redirect method="POST">/call/answer</Redirect>');
      expect(result).toContain("<Say");
    });

    it("should use route prefix", () => {
      const config: TalkerConfig = { ...baseConfig, routePrefix: "/api" };
      const result = acknowledgmentTwiml("en", config);
      expect(result).toContain("/api/call/answer");
    });

    it("should use a caller-supplied message verbatim instead of re-resolving the phrase", () => {
      const result = acknowledgmentTwiml("en", baseConfig, "Caller-supplied ack message");
      expect(result).toContain("Caller-supplied ack message</Say>");
    });
  });

  describe("farewellTwiml", () => {
    it("should generate farewell with hangup", () => {
      const result = farewellTwiml("en", baseConfig);
      expect(result).toContain("<Hangup/>");
      expect(result).toContain("<Say");
    });

    it("should use a caller-supplied message verbatim instead of re-resolving the phrase", () => {
      const result = farewellTwiml("en", baseConfig, "Caller-supplied farewell message");
      expect(result).toContain("Caller-supplied farewell message</Say>");
    });
  });

  describe("messageTwiml", () => {
    it("should generate SMS message TwiML", () => {
      const result = messageTwiml("Hello via SMS");
      expect(result).toContain("<Message>Hello via SMS</Message>");
    });

    it("should escape XML in messages", () => {
      const result = messageTwiml("A & B <test>");
      expect(result).toContain("A &amp; B &lt;test&gt;");
    });
  });

  // A bare "&" in spoken text makes Twilio reject the document with error
  // 12100 and drop the call, so every helper escapes what it interpolates.
  describe("XML escaping across every helper", () => {
    const UNSAFE = `Ben & Jerry's <b>"best"</b>`;
    const ESCAPED = "Ben &amp; Jerry&apos;s &lt;b&gt;&quot;best&quot;&lt;/b&gt;";

    it("escapes the gather prompt", () => {
      expect(gatherTwiml(UNSAFE, "en", baseConfig)).toContain(`>${ESCAPED}</Say>`);
    });

    it("escapes the say message", () => {
      expect(sayTwiml(UNSAFE, "en", baseConfig)).toContain(`>${ESCAPED}</Say>`);
    });

    it("escapes the transfer message", () => {
      expect(transferTwiml("en", baseConfig, UNSAFE)).toContain(`>${ESCAPED}</Say>`);
    });

    it("escapes the acknowledgment message", () => {
      expect(acknowledgmentTwiml("en", baseConfig, UNSAFE)).toContain(`>${ESCAPED}</Say>`);
    });

    it("escapes the farewell message", () => {
      expect(farewellTwiml("en", baseConfig, UNSAFE)).toContain(`>${ESCAPED}</Say>`);
    });

    it("escapes the SMS message", () => {
      expect(messageTwiml(UNSAFE)).toContain(`<Message>${ESCAPED}</Message>`);
    });

    it("leaves no raw ampersand anywhere in the document", () => {
      for (const twiml of [
        gatherTwiml(UNSAFE, "en", baseConfig),
        sayTwiml(UNSAFE, "en", baseConfig),
        transferTwiml("en", baseConfig, UNSAFE),
        acknowledgmentTwiml("en", baseConfig, UNSAFE),
        farewellTwiml("en", baseConfig, UNSAFE),
        messageTwiml(UNSAFE),
      ]) {
        expect(twiml).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
      }
    });

    it("stores the last prompt unescaped so retries do not stack entities", () => {
      // The no-speech ladder re-speaks the stored prompt through gatherTwiml,
      // which escapes again - an escaped store would yield "&amp;amp;".
      const phoneNumber = "+15551234567";
      gatherTwiml(UNSAFE, "en", baseConfig, phoneNumber);

      expect(getLastPrompt(phoneNumber)).toBe(UNSAFE);
      expect(gatherTwiml(getLastPrompt(phoneNumber) as string, "en", baseConfig)).toContain(
        `>${ESCAPED}</Say>`,
      );
    });
  });
});

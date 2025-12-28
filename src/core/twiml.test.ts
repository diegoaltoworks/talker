import { afterEach, describe, expect, it } from "bun:test";
import type { TalkerConfig } from "../types";
import { clearAllContexts, stopCleanup } from "./context";
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
  });

  describe("farewellTwiml", () => {
    it("should generate farewell with hangup", () => {
      const result = farewellTwiml("en", baseConfig);
      expect(result).toContain("<Hangup/>");
      expect(result).toContain("<Say");
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
});

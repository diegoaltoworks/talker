import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { logger, redactPhone } from "./logger";

describe("Logger", () => {
  describe("redactPhone", () => {
    it("should redact a full phone number keeping last 4 digits", () => {
      expect(redactPhone("+15551234567")).toBe("***4567");
    });

    it("should redact a phone number without country code", () => {
      expect(redactPhone("5551234567")).toBe("***4567");
    });

    it("should handle a phone with formatting", () => {
      expect(redactPhone("+1 (555) 123-4567")).toBe("***4567");
    });

    it("should return 'unknown' unchanged", () => {
      expect(redactPhone("unknown")).toBe("unknown");
    });

    it("should return empty string unchanged", () => {
      expect(redactPhone("")).toBe("");
    });

    it("should redact short numbers to just ***", () => {
      expect(redactPhone("1234")).toBe("***");
    });

    it("should handle 5-digit numbers", () => {
      expect(redactPhone("12345")).toBe("***2345");
    });
  });

  describe("logger.info redaction (actual emitted JSON)", () => {
    const originalDebug = process.env.DEBUG;
    const originalVerbose = process.env.TALKER_LOG_VERBOSE;

    beforeEach(() => {
      process.env.DEBUG = "true";
      delete process.env.TALKER_LOG_VERBOSE;
    });

    afterEach(() => {
      if (originalDebug === undefined) delete process.env.DEBUG;
      else process.env.DEBUG = originalDebug;
      if (originalVerbose === undefined) delete process.env.TALKER_LOG_VERBOSE;
      else process.env.TALKER_LOG_VERBOSE = originalVerbose;
    });

    function loggedEntry(emit: () => void): Record<string, unknown> {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        emit();
        expect(consoleSpy).toHaveBeenCalledTimes(1);
        return JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      } finally {
        consoleSpy.mockRestore();
      }
    }

    it("redacts a top-level phone field", () => {
      const entry = loggedEntry(() => logger.info("call started", { phoneNumber: "+15551234567" }));
      expect(entry.phoneNumber).toBe("***4567");
    });

    it("redacts a phone field nested inside another object", () => {
      const entry = loggedEntry(() =>
        logger.info("flow params extracted", {
          phoneNumber: "+15551234567",
          extracted: { phone: "+15559876543", name: "Alex" },
        }),
      );
      expect(entry.phoneNumber).toBe("***4567");
      expect((entry.extracted as Record<string, unknown>).phone).toBe("***6543");
      expect((entry.extracted as Record<string, unknown>).name).toBe("Alex");
    });

    it("redacts a phone field nested inside an array of objects", () => {
      const entry = loggedEntry(() =>
        logger.info("history", {
          messages: [{ phone: "+15551234567" }, { phone: "+15557654321" }],
        }),
      );
      const messages = entry.messages as Array<Record<string, unknown>>;
      expect(messages[0]?.phone).toBe("***4567");
      expect(messages[1]?.phone).toBe("***4321");
    });

    it("previews a long string field by default and never logs it verbatim", () => {
      const longMessage = `${"a".repeat(200)} secret`;
      const entry = loggedEntry(() => logger.info("INCOMING", { in: longMessage }));
      expect(entry.in).toBe(`${"a".repeat(160)}...`);
      expect(entry.in).not.toContain("secret");
    });

    it("logs full content when TALKER_LOG_VERBOSE=true", () => {
      process.env.TALKER_LOG_VERBOSE = "true";
      const longMessage = `${"a".repeat(200)} secret`;
      const entry = loggedEntry(() => logger.info("INCOMING", { in: longMessage }));
      expect(entry.in).toBe(longMessage);
    });

    it("leaves short string fields untouched", () => {
      const entry = loggedEntry(() => logger.info("flow started", { flow: "addNumbers" }));
      expect(entry.flow).toBe("addNumbers");
    });

    it("previews a long string field nested inside an object", () => {
      const longMessage = `${"b".repeat(200)} secret`;
      const entry = loggedEntry(() =>
        logger.info("flow instant complete", { params: { note: longMessage } }),
      );
      const params = entry.params as Record<string, unknown>;
      expect(params.note).toBe(`${"b".repeat(160)}...`);
    });

    it("serializes a Date instead of collapsing it to {}", () => {
      const entry = loggedEntry(() =>
        logger.info("scheduled", { at: new Date("2020-01-01T00:00:00.000Z") }),
      );
      expect(entry.at).toBe("2020-01-01T00:00:00.000Z");
    });

    it("serializes an Error to its message instead of collapsing it to {}", () => {
      const entry = loggedEntry(() =>
        logger.info("greetingFn error, using phrase greeting", { error: new Error("boom") }),
      );
      expect(entry.error).toBe("boom");
    });

    it("does not truncate diagnostic error/stack fields even when long", () => {
      const longError = "e".repeat(200);
      const entry = loggedEntry(() => logger.error("openai error", { error: longError }));
      expect(entry.error).toBe(longError);
    });
  });
});

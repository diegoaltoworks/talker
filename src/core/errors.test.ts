import { describe, expect, it } from "bun:test";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("should extract message from Error instances", () => {
    expect(getErrorMessage(new Error("test error"))).toBe("test error");
  });

  it("should return string errors directly", () => {
    expect(getErrorMessage("string error")).toBe("string error");
  });

  it("should return 'Unknown error' for other types", () => {
    expect(getErrorMessage(42)).toBe("Unknown error");
    expect(getErrorMessage(null)).toBe("Unknown error");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
    expect(getErrorMessage({ foo: "bar" })).toBe("Unknown error");
  });
});

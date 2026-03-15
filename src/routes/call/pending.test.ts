/**
 * Pending Queries Tests
 *
 * Tests for the pending query store used by async acknowledgment pattern.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { deletePending, getPending, setPending } from "./pending";

describe("Pending Queries", () => {
  afterEach(() => {
    deletePending("+1111");
    deletePending("+2222");
  });

  it("should store and retrieve a pending query", () => {
    const query = {
      speechResult: "test speech",
      promise: Promise.resolve({ twiml: "<Response/>" }),
      resolve: () => {},
    };

    setPending("+1111", query);
    const retrieved = getPending("+1111");

    expect(retrieved).toBeDefined();
    expect(retrieved?.speechResult).toBe("test speech");
  });

  it("should return undefined for unknown phone number", () => {
    expect(getPending("+9999")).toBeUndefined();
  });

  it("should delete a pending query", () => {
    setPending("+1111", {
      speechResult: "test",
      promise: Promise.resolve({ twiml: "" }),
      resolve: () => {},
    });

    deletePending("+1111");
    expect(getPending("+1111")).toBeUndefined();
  });

  it("should handle deleting non-existent query gracefully", () => {
    // Should not throw
    deletePending("+9999");
    expect(getPending("+9999")).toBeUndefined();
  });

  it("should store separate queries per phone number", () => {
    setPending("+1111", {
      speechResult: "first",
      promise: Promise.resolve({ twiml: "" }),
      resolve: () => {},
    });
    setPending("+2222", {
      speechResult: "second",
      promise: Promise.resolve({ twiml: "" }),
      resolve: () => {},
    });

    expect(getPending("+1111")?.speechResult).toBe("first");
    expect(getPending("+2222")?.speechResult).toBe("second");
  });

  it("should overwrite existing pending query for same phone number", () => {
    setPending("+1111", {
      speechResult: "old",
      promise: Promise.resolve({ twiml: "" }),
      resolve: () => {},
    });
    setPending("+1111", {
      speechResult: "new",
      promise: Promise.resolve({ twiml: "" }),
      resolve: () => {},
    });

    expect(getPending("+1111")?.speechResult).toBe("new");
  });
});

import { describe, expect, it } from "bun:test";
import { fireAndForget } from "./fire-and-forget";

describe("fireAndForget", () => {
  it("runs the callback without the caller awaiting it", async () => {
    let ran = false;
    fireAndForget(
      () => {
        ran = true;
      },
      () => {},
    );
    expect(ran).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it("runs an async callback to completion", async () => {
    let ran = false;
    fireAndForget(
      async () => {
        ran = true;
      },
      () => {},
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it("routes a synchronous throw to onError instead of throwing", async () => {
    let caught: unknown;
    expect(() =>
      fireAndForget(
        () => {
          throw new Error("boom");
        },
        (error) => {
          caught = error;
        },
      ),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect((caught as Error).message).toBe("boom");
  });

  it("routes an async rejection to onError without an unhandled rejection", async () => {
    let caught: unknown;
    fireAndForget(
      async () => {
        throw new Error("async boom");
      },
      (error) => {
        caught = error;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect((caught as Error).message).toBe("async boom");
  });
});

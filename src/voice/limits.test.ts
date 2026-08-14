import { describe, expect, it } from "bun:test";
import {
  createVoiceLimiter,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  DEFAULT_PER_NUMBER_DAILY_LIMIT,
  GLOBAL_LIMIT_KEY,
  pickDailyLimit,
  resolveVoiceLimitsConfig,
  utcDayKey,
  type VoiceLimitsStore,
} from "./limits";

/** In-memory store standing in for a host's database-backed counters. */
function memoryStore() {
  const counts = new Map<string, number>();
  const calls: Array<{ scope: string; key: string; day: string }> = [];
  const store: VoiceLimitsStore = {
    async incrementAndGet(scope, key, day) {
      calls.push({ scope, key, day });
      const id = `${scope}:${key}:${day}`;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
      return next;
    },
  };
  return { store, calls, counts };
}

const NOON = Date.parse("2026-08-14T12:00:00Z");
const DAY = 86_400_000;

describe("utcDayKey", () => {
  it("keys on the UTC calendar day", () => {
    expect(utcDayKey(Date.parse("2026-08-14T12:00:00Z"))).toBe("2026-08-14");
  });

  it("rolls over at UTC midnight, not local midnight", () => {
    expect(utcDayKey(Date.parse("2026-08-14T23:59:59Z"))).toBe("2026-08-14");
    expect(utcDayKey(Date.parse("2026-08-15T00:00:00Z"))).toBe("2026-08-15");
  });
});

describe("pickDailyLimit", () => {
  it("uses a configured non-negative integer", () => {
    expect(pickDailyLimit("25", 100)).toBe(25);
    expect(pickDailyLimit("0", 100)).toBe(0);
  });

  it("falls back for unset, empty, negative, fractional and non-numeric values", () => {
    expect(pickDailyLimit(undefined, 100)).toBe(100);
    expect(pickDailyLimit("", 100)).toBe(100);
    expect(pickDailyLimit("-5", 100)).toBe(100);
    expect(pickDailyLimit("2.5", 100)).toBe(100);
    expect(pickDailyLimit("lots", 100)).toBe(100);
  });
});

describe("resolveVoiceLimitsConfig", () => {
  it("defaults when nothing is configured", () => {
    expect(resolveVoiceLimitsConfig()).toEqual({
      perNumberDailyLimit: DEFAULT_PER_NUMBER_DAILY_LIMIT,
      globalDailyLimit: DEFAULT_GLOBAL_DAILY_LIMIT,
    });
  });

  it("reads limits from the supplied environment object", () => {
    expect(
      resolveVoiceLimitsConfig({ VOICE_LIMIT_PER_NUMBER: "7", VOICE_LIMIT_GLOBAL: "70" }),
    ).toEqual({ perNumberDailyLimit: 7, globalDailyLimit: 70 });
  });

  it("lets explicit overrides win over the environment", () => {
    expect(
      resolveVoiceLimitsConfig(
        { VOICE_LIMIT_PER_NUMBER: "7", VOICE_LIMIT_GLOBAL: "70" },
        { perNumberDailyLimit: 1 },
      ),
    ).toEqual({ perNumberDailyLimit: 1, globalDailyLimit: 70 });
  });

  it("honours an override of zero rather than treating it as unset", () => {
    expect(resolveVoiceLimitsConfig({}, { perNumberDailyLimit: 0 }).perNumberDailyLimit).toBe(0);
  });
});

describe("createVoiceLimiter", () => {
  it("allows requests up to the per-number cap and blocks the next one", async () => {
    const { store } = memoryStore();
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 2, globalDailyLimit: 100 },
      { store, now: () => NOON },
    );

    expect(await limiter.checkAndReserve("+15550001")).toEqual({ allowed: true, reason: null });
    expect(await limiter.checkAndReserve("+15550001")).toEqual({ allowed: true, reason: null });
    expect(await limiter.checkAndReserve("+15550001")).toEqual({
      allowed: false,
      reason: "per-number",
    });
  });

  it("counts each number separately", async () => {
    const { store } = memoryStore();
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 1, globalDailyLimit: 100 },
      { store, now: () => NOON },
    );

    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(true);
    expect((await limiter.checkAndReserve("+15550002")).allowed).toBe(true);
    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(false);
  });

  it("blocks on the global cap once the shared budget is spent", async () => {
    const { store } = memoryStore();
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 100, globalDailyLimit: 2 },
      { store, now: () => NOON },
    );

    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(true);
    expect((await limiter.checkAndReserve("+15550002")).allowed).toBe(true);
    expect(await limiter.checkAndReserve("+15550003")).toEqual({
      allowed: false,
      reason: "global",
    });
  });

  it("does not touch the global budget for a number blocked at its own cap", async () => {
    const { store, calls } = memoryStore();
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 1, globalDailyLimit: 100 },
      { store, now: () => NOON },
    );

    await limiter.checkAndReserve("+15550001");
    calls.length = 0;
    await limiter.checkAndReserve("+15550001");

    expect(calls.map((call) => call.scope)).toEqual(["number"]);
  });

  it("reserves against the global counter under the shared key", async () => {
    const { store, calls } = memoryStore();
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 10, globalDailyLimit: 10 },
      { store, now: () => NOON },
    );

    await limiter.checkAndReserve("+15550001");

    expect(calls).toEqual([
      { scope: "number", key: "+15550001", day: "2026-08-14" },
      { scope: "global", key: GLOBAL_LIMIT_KEY, day: "2026-08-14" },
    ]);
  });

  it("starts a fresh budget after the UTC day rolls over", async () => {
    const { store } = memoryStore();
    let now = NOON;
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 1, globalDailyLimit: 1 },
      { store, now: () => now },
    );

    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(true);
    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(false);

    now = NOON + DAY;
    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(true);
  });

  it("blocks everything when a cap is configured to zero", async () => {
    const { store } = memoryStore();
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 0, globalDailyLimit: 100 },
      { store, now: () => NOON },
    );

    expect(await limiter.checkAndReserve("+15550001")).toEqual({
      allowed: false,
      reason: "per-number",
    });
  });

  it("is satisfied structurally by any object with a matching incrementAndGet", async () => {
    // No import of talker's types on the host side — a plain object literal
    // with the right shape is enough, which is what keeps the store swappable.
    const adHocStore = { incrementAndGet: async () => 1 };
    const limiter = createVoiceLimiter(
      { perNumberDailyLimit: 5, globalDailyLimit: 5 },
      { store: adHocStore, now: () => NOON },
    );

    expect((await limiter.checkAndReserve("+15550001")).allowed).toBe(true);
  });
});

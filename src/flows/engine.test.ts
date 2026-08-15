/**
 * Flow engine loader test.
 *
 * The loader exists so `@diegoaltoworks/chatter` can stay an optional peer:
 * see src/peer-deps.test.ts for the guard that keeps it that way, and
 * ./registry.test.ts for what happens on the flow path when it is absent.
 */

import { describe, expect, it } from "bun:test";
import { loadFlowEngine } from "./engine";

describe("loadFlowEngine", () => {
  it("loads chatter's flow engine functions", async () => {
    const engine = await loadFlowEngine();

    expect(typeof engine.detectIntent).toBe("function");
    expect(typeof engine.extractParameters).toBe("function");
  });
});

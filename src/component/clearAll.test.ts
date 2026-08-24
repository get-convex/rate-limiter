import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import type { RateLimitConfigValue } from "../shared.js";

const config = {
  kind: "token bucket",
  rate: 10,
  period: 60_000,
  lazy: true,
} as RateLimitConfigValue;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// `clearAll` walks two tables newest-first, a page of 100 each per pass. When
// both pages come back full it has to resume from the *newer* of the two
// cutoffs; resuming from the older one skips whatever the other table still has
// above it.
test("clearAll empties both tables when their pages end far apart", async () => {
  const t = initConvexTest();

  // Distinct creation times, oldest first, so the two tables' pages end at
  // different points: all the limits are older than all the queued updates.
  for (let i = 0; i < 101; i++) {
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        name: `limit${i}`,
        shard: 0,
        value: 1,
        ts: Date.now(),
      });
    });
    vi.advanceTimersByTime(1);
  }
  for (let i = 0; i < 101; i++) {
    await t.run(async (ctx) => {
      await ctx.db.insert("pendingUpdates", {
        name: `queued${i}`,
        count: 1,
        config,
        updatedAt: ctx.db.vars.commitTs,
      });
    });
    vi.advanceTimersByTime(1);
  }

  await t.mutation(api.lib.clearAll, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const left = await t.run(async (ctx) => ({
    rateLimits: await ctx.db.query("rateLimits").collect(),
    pendingUpdates: await ctx.db.query("pendingUpdates").collect(),
  }));
  expect(left.rateLimits).toHaveLength(0);
  expect(left.pendingUpdates).toHaveLength(0);
});

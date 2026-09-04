import { anyApi, type ApiFromModules } from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HOUR, RateLimiter } from "../../src/client/index.js";
import { getValueReturns, rateLimitReturns } from "../../src/shared.js";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { initConvexTest } from "./setup.test.js";

const limiter = new RateLimiter(components.rateLimiter, {
  lazy: {
    kind: "fixed window",
    rate: 2,
    period: HOUR,
    capacity: 2,
    start: 0,
  },
  lazySharded: {
    kind: "fixed window",
    rate: 8,
    period: HOUR,
    capacity: 8,
    shards: 8,
    start: 0,
  },
});

export const limitLazy = mutation({
  args: {
    key: v.optional(v.string()),
    count: v.optional(v.number()),
    reserve: v.optional(v.boolean()),
  },
  returns: rateLimitReturns,
  handler: async (ctx, args) =>
    limiter.limit(ctx, "lazy", { ...args, stale: true }),
});

export const checkLazy = query({
  args: { key: v.optional(v.string()), count: v.optional(v.number()) },
  returns: rateLimitReturns,
  handler: async (ctx, args) =>
    limiter.check(ctx, "lazy", { ...args, stale: true }),
});

export const valueLazy = query({
  args: { key: v.optional(v.string()) },
  returns: getValueReturns,
  handler: async (ctx, args) => limiter.getValue(ctx, "lazy", args),
});

export const limitLazySharded = mutation({
  args: { count: v.number() },
  returns: rateLimitReturns,
  handler: async (ctx, args) =>
    limiter.limit(ctx, "lazySharded", { count: args.count, stale: true }),
});

export const checkLazySharded = query({
  args: { count: v.number() },
  returns: rateLimitReturns,
  handler: async (ctx, args) =>
    limiter.check(ctx, "lazySharded", { count: args.count, stale: true }),
});

const testApi = (
  anyApi as unknown as ApiFromModules<{
    "lazyRateLimit.test": {
      limitLazy: typeof limitLazy;
      checkLazy: typeof checkLazy;
      valueLazy: typeof valueLazy;
      limitLazySharded: typeof limitLazySharded;
      checkLazySharded: typeof checkLazySharded;
    };
  }>
)["lazyRateLimit.test"];

describe("lazy rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("limit with stale flag checks a snapshot and enqueues consumption", async () => {
    const t = initConvexTest();

    await expect(t.mutation(testApi.limitLazy, {})).resolves.toEqual({
      ok: true,
      retryAfter: undefined,
    });
    await expect(t.mutation(testApi.limitLazy, {})).resolves.toEqual({
      ok: true,
      retryAfter: undefined,
    });
    await expect(t.query(testApi.checkLazy, {})).resolves.toEqual({
      ok: true,
      retryAfter: undefined,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const afterDrain = await t.query(testApi.checkLazy, {});
    expect(afterDrain.ok).toBe(false);
    expect(afterDrain.retryAfter).toBeGreaterThan(0);
  });

  test("stale consumption is scoped per key", async () => {
    const t = initConvexTest();

    await expect(
      t.mutation(testApi.limitLazy, { key: "a", count: 2 }),
    ).resolves.toEqual({
      ok: true,
      retryAfter: undefined,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const sameKey = await t.query(testApi.checkLazy, { key: "a", count: 2 });
    expect(sameKey.ok).toBe(false);
    expect(sameKey.retryAfter).toBeGreaterThan(0);

    await expect(
      t.query(testApi.checkLazy, { key: "b", count: 2 }),
    ).resolves.toEqual({
      ok: true,
      retryAfter: undefined,
    });
  });

  test("stale reserve enqueues consumption even when the limit is exceeded", async () => {
    const t = initConvexTest();

    // Exhaust the limit (capacity 2).
    await t.mutation(testApi.limitLazy, { count: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.query(testApi.valueLazy, {})).value).toBe(0);

    // Without reserve, a rejected request enqueues nothing.
    await expect(t.mutation(testApi.limitLazy, {})).resolves.toMatchObject({
      ok: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.query(testApi.valueLazy, {})).value).toBe(0);

    // With reserve, the consumption is enqueued anyway, driving the value
    // negative so future capacity is delayed.
    await expect(
      t.mutation(testApi.limitLazy, { reserve: true }),
    ).resolves.toMatchObject({ ok: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.query(testApi.valueLazy, {})).value).toBe(-1);
  });

  test("lazy mode can spend across the highest-value shards", async () => {
    const t = initConvexTest();

    for (let i = 0; i < 4; i++) {
      await expect(
        t.mutation(testApi.limitLazySharded, { count: 2 }),
      ).resolves.toEqual({
        ok: true,
        retryAfter: undefined,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }

    const exhausted = await t.query(testApi.checkLazySharded, { count: 1 });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.retryAfter).toBeGreaterThan(0);
  });
});

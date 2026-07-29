import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
import { api, internal } from "./_generated/api.js";
import type { RateLimitConfig } from "../shared.js";

const Second = 1_000;
const Minute = 60 * Second;

describe("batched credit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("credits the emptiest shard, capping at capacity", async () => {
    const t = convexTest(schema, modules);
    const name = "credit";
    // Single shard, capacity 10.
    const config: RateLimitConfig = {
      kind: "token bucket",
      rate: 10,
      period: Minute,
      capacity: 10,
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        name,
        shard: 0,
        value: 3,
        ts: Date.now(),
      });
    });

    // Crediting within the remaining room returns the full amount.
    const partial = await t.query(api.batched.credit, {
      name,
      count: 5,
      config,
    });
    expect(partial.updates).toEqual([{ shard: 0, count: -5 }]);

    // Crediting past capacity is capped at the remaining room (10 - 3 = 7).
    const capped = await t.query(api.batched.credit, {
      name,
      count: 20,
      config,
    });
    expect(capped.updates).toEqual([{ shard: 0, count: -7 }]);
  });

  test("a full limit accepts no credit", async () => {
    const t = convexTest(schema, modules);
    const name = "full";
    const config: RateLimitConfig = {
      kind: "token bucket",
      rate: 10,
      period: Minute,
      capacity: 10,
    };
    // No doc yet -> the limit is full (value === capacity), so nothing to credit.
    const result = await t.query(api.batched.credit, { name, count: 5, config });
    expect(result.updates).toEqual([]);
  });

  test("fills the lowest shards first, spilling as they fill", async () => {
    const t = convexTest(schema, modules);
    const name = "spill";
    // 3 shards, total capacity 30 -> 10 per shard.
    const config: RateLimitConfig = {
      kind: "token bucket",
      rate: 30,
      period: Minute,
      capacity: 30,
      shards: 3,
    };
    await t.run(async (ctx) => {
      const ts = Date.now();
      await ctx.db.insert("rateLimits", { name, shard: 0, value: 2, ts });
      await ctx.db.insert("rateLimits", { name, shard: 1, value: 8, ts });
      await ctx.db.insert("rateLimits", { name, shard: 2, value: 9, ts });
    });

    // rooms: shard0=8, shard1=2, shard2=1. Credit 12 fills 0, then 1, then 2.
    const result = await t.query(api.batched.credit, {
      name,
      count: 12,
      config,
    });
    expect(result.updates).toEqual([
      { shard: 0, count: -8 },
      { shard: 1, count: -2 },
      { shard: 2, count: -1 },
    ]);
  });
});

describe("batched applyBatch clamps credit at capacity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("net credit never pushes a shard above its capacity", async () => {
    const t = convexTest(schema, modules);
    const name = "apply";
    const config: RateLimitConfig = {
      kind: "token bucket",
      rate: 10,
      period: Minute,
      capacity: 10,
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        name,
        shard: 0,
        value: 8,
        ts: Date.now(),
      });
      // Enqueue a credit of 5 (negative consumption) that would overflow.
      await ctx.db.insert("consumption", {
        name,
        shard: 0,
        count: -5,
        config,
      });
    });

    await t.run(async (ctx) => {
      const items = await ctx.db.query("consumption").collect();
      await ctx.runMutation(internal.batched.applyBatch, {
        items: items.map((i) => ({
          id: i._id,
          name: i.name,
          key: i.key,
          shard: i.shard,
          count: i.count,
          config: i.config,
        })),
      });
    });

    const doc = await t.run(async (ctx) =>
      ctx.db
        .query("rateLimits")
        .withIndex("name", (q) =>
          q.eq("name", name).eq("key", undefined).eq("shard", 0),
        )
        .unique(),
    );
    // 8 + 5 = 13, clamped to the capacity of 10.
    expect(doc?.value).toBe(10);
    // The queued consumption row was drained.
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("consumption").collect(),
    );
    expect(remaining).toHaveLength(0);
  });
});

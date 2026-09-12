import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
import { api } from "./_generated/api.js";

const Second = 1_000;
const Minute = 60 * Second;
const Hour = 60 * Minute;

describe.each(["token bucket", "fixed window"] as const)(
  "rateLimit %s",
  (kind) => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("simple check", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const config = { kind, rate: 1, period: Second };
      await t.run(async (ctx) => {
        const before = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(before.ok).toBe(true);
        expect(before.retryAfter).toBe(undefined);
        const actual = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
        });
        expect(actual.ok).toBe(true);
        expect(actual.retryAfter).toBe(undefined);
        const after = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(after.ok).toBe(false);
        expect(after.retryAfter).toBeGreaterThan(0);
      });
    });

    test("simple consume", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const config = { kind, rate: 1, period: Second };
      const global = await t.run(
        async (ctx) =>
          await ctx.runMutation(api.lib.rateLimit, {
            name,
            config,
          }),
      );
      expect(global.ok).toBe(true);
      expect(global.retryAfter).toBe(undefined);
      const after = await t.run(
        async (ctx) =>
          await ctx.runMutation(api.lib.rateLimit, {
            name,
            config,
          }),
      );
      expect(after.ok).toBe(false);
      expect(after.retryAfter).toBeGreaterThan(0);
    });

    test("consume too much", async () => {
      const t = convexTest(schema, modules);
      await expect(() =>
        t.run(async (ctx) => {
          await ctx.runMutation(api.lib.rateLimit, {
            name: "simple",
            count: 2,
            config: {
              kind: "fixed window",
              rate: 1,
              period: Second,
            },
          });
        }),
      ).rejects.toThrow("Rate limit simple count 2 exceeds 1.");
    });

    test("keyed", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const config = { kind, rate: 1, period: Second };
      const keyed = await t.run(
        async (ctx) =>
          await ctx.runMutation(api.lib.rateLimit, {
            name,
            config,
            key: "key",
          }),
      );
      expect(keyed.ok).toBe(true);
      expect(keyed.retryAfter).toBe(undefined);
      const keyed2 = await t.run(
        async (ctx) =>
          await ctx.runMutation(api.lib.rateLimit, {
            name,
            config,
            key: "key2",
          }),
      );
      expect(keyed2.ok).toBe(true);
      expect(keyed2.retryAfter).toBe(undefined);
    });

    test("burst", async () => {
      const t = convexTest(schema, modules);
      const name = "burst";
      const config = { kind, rate: 1, period: Second, capacity: 3 };
      await t.run(async (ctx) => {
        const before = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
          count: 3,
        });
        expect(before.ok).toBe(true);
        expect(before.retryAfter).toBe(undefined);
        const keyed = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          key: "foo",
          count: 3,
        });
        expect(keyed.ok).toBe(true);
        expect(keyed.retryAfter).toBe(undefined);
        const no = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          key: "foo",
        });
        expect(no.ok).toBe(false);
      });
    });

    test("retryAfter is accurate", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const config = { kind, rate: 10, period: Minute };
      const one = await t.run(async (ctx) => {
        const result = await ctx.runMutation(api.lib.rateLimit, {
          name,
          count: 5,
          config,
        });
        expect(result.ok).toBe(true);
        expect(result.retryAfter).toBe(undefined);
        return ctx.db
          .query("rateLimits")
          .withIndex("name", (q) => q.eq("name", "simple"))
          .unique();
      });
      expect(one).toBeDefined();
      if (kind === "token bucket") {
        vi.setSystemTime(one!.ts + 6 * Second);
      } else {
        vi.setSystemTime(one!.ts + 1 * Minute);
      }
      const two = await t.run(async (ctx) => {
        const result = await ctx.runMutation(api.lib.rateLimit, {
          name,
          count: 6,
          config,
        });
        expect(result.ok).toBe(true);
        expect(result.retryAfter).toBe(undefined);
        return ctx.db
          .query("rateLimits")
          .withIndex("name", (q) => q.eq("name", "simple"))
          .unique();
      });
      expect(two).toBeDefined();
      if (kind === "token bucket") {
        expect(two!.value).toBe(0);
      } else {
        expect(two!.value).toBe(4);
      }
      const three = await t.run(async (ctx) => {
        const result = await ctx.runMutation(api.lib.rateLimit, {
          name,
          count: 10,
          config,
        });
        expect(result.ok).toBe(false);
        // the token bucket needs to wait a minute from now
        // the fixed window needs to wait a minute from the last window
        // which is stored as ts.
        expect(result.retryAfter).toBe(Minute);
        return ctx.db
          .query("rateLimits")
          .withIndex("name", (q) => q.eq("name", "simple"))
          .unique();
      });
      expect(three).toBeDefined();
      expect(three!.value).toBe(two!.value);
      expect(three!.ts).toBe(two!.ts);
    });

    test("retryAfter for reserved is accurate", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const config = { kind, rate: 10, period: Minute };
      const one = await t.run(async (ctx) => {
        const result = await ctx.runMutation(api.lib.rateLimit, {
          name,
          count: 5,
          config,
        });
        expect(result.ok).toBe(true);
        expect(result.retryAfter).toBe(undefined);
        return ctx.db
          .query("rateLimits")
          .withIndex("name", (q) => q.eq("name", name))
          .unique();
      });
      expect(one).toBeDefined();
      expect(one!.value).toBe(5);
      if (kind === "token bucket") {
        vi.setSystemTime(one!.ts + 6 * Second);
      } else {
        vi.setSystemTime(one!.ts + 1 * Minute);
      }
      const two = await t.run(async (ctx) => {
        const result = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          count: 16,
          reserve: true,
        });
        expect(result.ok).toBe(true);
        expect(result.retryAfter).toBe(Minute);
        return ctx.db
          .query("rateLimits")
          .withIndex("name", (q) => q.eq("name", name))
          .unique();
      });
      expect(two).toBeDefined();
      if (kind === "token bucket") {
        expect(two!.value).toBe(-10);
      } else {
        expect(two!.value).toBe(-6);
      }
      vi.setSystemTime(two!.ts + 30 * Second);
      const three = await t.run(async (ctx) => {
        const result = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          count: 5,
          reserve: true,
        });
        expect(result.ok).toBe(true);
        if (kind === "token bucket") {
          expect(result.retryAfter).toBe(Minute);
        } else {
          expect(result.retryAfter).toBe(30 * Second + Minute);
        }
        return ctx.db
          .query("rateLimits")
          .withIndex("name", (q) => q.eq("name", name))
          .unique();
      });
      expect(three).toBeDefined();
      if (kind === "token bucket") {
        expect(three!.value).toBe(-10);
      } else {
        expect(three!.value).toBe(-11);
      }
    });

    test("simple reset", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const config = { kind, rate: 1, period: Second };
      await t.run(async (ctx) => {
        const before = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(before.ok).toBe(true);
        expect(before.retryAfter).toBe(undefined);
        await ctx.runMutation(api.lib.resetRateLimit, { name });
        const after = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(after.ok).toBe(true);
        expect(after.retryAfter).toBe(undefined);
      });
    });

    test("keyed reset", async () => {
      const t = convexTest(schema, modules);
      const name = "simple";
      const key = "key";
      const config = { kind, rate: 1, period: Second };
      await t.run(async (ctx) => {
        const before = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
          key,
        });
        expect(before.ok).toBe(true);
        expect(before.retryAfter).toBe(undefined);
        await ctx.runMutation(api.lib.resetRateLimit, { name, key });
        const after = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
          key,
        });
        expect(after.ok).toBe(true);
        expect(after.retryAfter).toBe(undefined);
      });
    });

    test("reserved without max", async () => {
      const t = convexTest(schema, modules);
      const name = "reserved";
      const config = { kind, rate: 1, period: Hour };
      await t.run(async (ctx) => {
        const before = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(before.ok).toBe(true);
        expect(before.retryAfter).toBe(undefined);
        const reserved = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          count: 100,
          reserve: true,
        });
        expect(reserved.ok).toBe(true);
        expect(reserved.retryAfter).toBeGreaterThan(0);
        const noSimple = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(noSimple.ok).toBe(false);
        expect(noSimple.retryAfter).toBeGreaterThan(reserved.retryAfter!);
      });
    });

    test("reserved with max", async () => {
      const t = convexTest(schema, modules);
      const name = "reserved";
      const config = {
        kind,
        rate: 1,
        period: Hour,
        maxReserved: 1,
      };
      await t.run(async (ctx) => {
        const check = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
          count: 2,
          reserve: true,
        });
        expect(check.ok).toBe(true);
        const reserved = await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          count: 2,
          reserve: true,
        });
        expect(reserved.ok).toBe(true);
        expect(reserved.retryAfter).toBeGreaterThan(0);
        const noSimple = await ctx.runQuery(api.lib.checkRateLimit, {
          name,
          config,
        });
        expect(noSimple.ok).toBe(false);
      });
    });

    test("consume too much reserved", async () => {
      const t = convexTest(schema, modules);
      await expect(() =>
        t.run(async (ctx) => {
          await ctx.runMutation(api.lib.rateLimit, {
            name: "simple",
            count: 4,
            reserve: true,
            config: {
              kind: "fixed window",
              rate: 1,
              period: Second,
              maxReserved: 2,
            },
          });
        }),
      ).rejects.toThrow("Rate limit simple count 4 exceeds 3.");
    });
  },
);

describe.each(["token bucket", "fixed window"] as const)(
  "creditRateLimit %s",
  (kind) => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("restores consumed capacity", async () => {
      const t = convexTest(schema, modules);
      const name = "credit";
      const config = { kind, rate: 3, period: Hour };
      for (let i = 0; i < 3; i++) {
        await t.mutation(api.lib.rateLimit, { name, config });
      }
      expect((await t.query(api.lib.checkRateLimit, { name, config })).ok).toBe(
        false,
      );

      await t.mutation(api.lib.creditRateLimit, { name, config, count: 2 });

      expect((await t.query(api.lib.getValue, { name, config })).value).toBe(2);
      expect((await t.query(api.lib.checkRateLimit, { name, config })).ok).toBe(
        true,
      );
    });

    test("defaults to crediting one token", async () => {
      const t = convexTest(schema, modules);
      const name = "credit";
      const config = { kind, rate: 3, period: Hour };
      await t.mutation(api.lib.rateLimit, { name, config, count: 3 });
      await t.mutation(api.lib.creditRateLimit, { name, config });
      expect((await t.query(api.lib.getValue, { name, config })).value).toBe(1);
    });

    test("never credits past capacity", async () => {
      const t = convexTest(schema, modules);
      const name = "capped";
      const config = { kind, rate: 3, period: Hour };
      await t.mutation(api.lib.rateLimit, { name, config });
      await t.mutation(api.lib.creditRateLimit, { name, config, count: 100 });
      expect((await t.query(api.lib.getValue, { name, config })).value).toBe(3);
    });

    test("does not write to a limit with no document", async () => {
      const t = convexTest(schema, modules);
      const name = "untouched";
      const config = { kind, rate: 3, period: Hour };
      await t.mutation(api.lib.creditRateLimit, { name, config, count: 3 });
      expect(
        await t.run((ctx) => ctx.db.query("rateLimits").collect()),
      ).toEqual([]);
    });

    test("credits only the given key", async () => {
      const t = convexTest(schema, modules);
      const name = "keyed";
      const config = { kind, rate: 1, period: Hour };
      for (const key of ["a", "b"]) {
        await t.mutation(api.lib.rateLimit, { name, config, key });
      }
      await t.mutation(api.lib.creditRateLimit, { name, config, key: "a" });

      const values = await t.run(async (ctx) =>
        Object.fromEntries(
          (await ctx.db.query("rateLimits").collect()).map((doc) => [
            doc.key,
            doc.value,
          ]),
        ),
      );
      expect(values).toEqual({ a: 1, b: 0 });
    });

    // 3 shards of a rate of 30 gives each shard a capacity of 10.
    const shardedConfig = (values: number[]) => ({
      kind,
      rate: 10 * values.length,
      period: Hour,
      shards: values.length,
    });
    async function withShards(
      t: ReturnType<typeof convexTest<(typeof schema)["tables"]>>,
      name: string,
      values: number[],
    ) {
      await t.run(async (ctx) => {
        const ts = Date.now();
        for (const [shard, value] of values.entries()) {
          await ctx.db.insert("rateLimits", { name, shard, value, ts });
        }
      });
    }

    test("spreads a credit over at most two random shards", async () => {
      const t = convexTest(schema, modules);
      const name = "random";
      const config = shardedConfig([0, 0, 0, 0]);
      await withShards(t, name, [0, 0, 0, 0]);

      // Far more than the two shards it reads can hold: the rest is discarded.
      await t.mutation(api.lib.creditRateLimit, { name, config, count: 100 });
      const values = await shardValues(t, name);
      expect(values.filter((value) => value === 10)).toHaveLength(2);
      expect(values.filter((value) => value === 0)).toHaveLength(2);
    });

    test("stops at one shard when it takes the whole credit", async () => {
      const t = convexTest(schema, modules);
      const name = "onlyone";
      const config = shardedConfig([0, 0, 0]);
      await withShards(t, name, [0, 0, 0]);

      await t.mutation(api.lib.creditRateLimit, { name, config, count: 10 });
      const values = await shardValues(t, name);
      expect(values.filter((value) => value === 10)).toHaveLength(1);
      expect(values.filter((value) => value === 0)).toHaveLength(2);
    });

    test("only reads one shard when there are too few to choose two", async () => {
      const t = convexTest(schema, modules);
      const name = "twoshards";
      const config = shardedConfig([0, 0]);
      await withShards(t, name, [0, 0]);

      // 15 is more than the one shard it looks at can hold, and it won't go
      // looking for the other: a second read would depend on every shard.
      await t.mutation(api.lib.creditRateLimit, { name, config, count: 15 });
      const values = await shardValues(t, name);
      expect(values.filter((value) => value === 10)).toHaveLength(1);
      expect(values.filter((value) => value === 0)).toHaveLength(1);
    });

    test("rejects a negative count", async () => {
      const t = convexTest(schema, modules);
      const config = { kind, rate: 3, period: Hour };
      await expect(
        t.mutation(api.lib.creditRateLimit, {
          name: "negative",
          config,
          count: -1,
        }),
      ).rejects.toThrow("credit count -1 is negative");
    });
  },
);

async function shardValues(
  t: ReturnType<typeof convexTest<(typeof schema)["tables"]>>,
  name: string,
): Promise<number[]> {
  const docs = await t.run(async (ctx) =>
    ctx.db
      .query("rateLimits")
      .withIndex("name", (q) => q.eq("name", name))
      .collect(),
  );
  return docs.sort((a, b) => a.shard - b.shard).map((doc) => doc.value);
}

describe("asynchronous configs", () => {
  const config = {
    kind: "token bucket",
    rate: 1,
    period: Hour,
    applyUpdates: "asynchronously",
  } as const;

  test("can't be applied by rateLimit", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.lib.rateLimit, { name: "async", config }),
    ).rejects.toThrow(
      'Rate limit config for async has `applyUpdates: "asynchronously"`',
    );
  });

  test("can't be credited by creditRateLimit", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.lib.creditRateLimit, { name: "async", config }),
    ).rejects.toThrow(
      'Rate limit config for async has `applyUpdates: "asynchronously"`',
    );
  });

  test.each(["consume", "credit"] as const)(
    "a %s update can't be queued when updates are applied transactionally",
    async (kind) => {
      const t = convexTest(schema, modules);
      const enqueued = {
        name: "eager",
        count: 1,
        config: { ...config, applyUpdates: "transactionally" as const },
      };
      // Only consumption carries a timestamp; a credit has no time of its own.
      const update =
        kind === "consume"
          ? { ...enqueued, kind, ts: Date.now() }
          : { ...enqueued, kind };
      await expect(
        t.mutation(api.lib.enqueueUpdates, { updates: [update] }),
      ).rejects.toThrow(
        'Rate limit config for eager has `applyUpdates: "transactionally"`',
      );
    },
  );

  test("are readable, since the async path checks through the same query", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.query(api.lib.checkRateLimit, { name: "async", config }),
    ).toEqual({ ok: true, retryAfter: undefined });
    const { value, config: applied } = await t.query(api.lib.getValue, {
      name: "async",
      config,
    });
    expect(value).toBe(1);
    // Collapsed onto the singleton shard the worker writes.
    expect(applied.shards).toBe(1);
  });
});

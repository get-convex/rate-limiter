import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import type { RateLimitConfigValue, RateLimitError } from "../shared.js";
import { isRateLimitError } from "../client/index.js";

const Second = 1_000;
const Minute = 60 * Second;

/** Run the batch worker (and everything it schedules) to completion. */
async function drainWorker(t: ReturnType<typeof initConvexTest>) {
  const now = Date.now();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // Draining walks the worker's scheduled chain, which pushes the fake clock
  // forward by minutes. Wind it back so replenishment doesn't muddy assertions
  // about what the batch applied.
  vi.setSystemTime(now);
}

describe.each(["token bucket", "fixed window"] as const)(
  "lazy rate limits (%s)",
  (kind) => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const config = {
      kind,
      rate: 10,
      period: Minute,
      lazy: true,
    } as RateLimitConfigValue;

    test("consuming queues an update the worker applies", async () => {
      const t = initConvexTest();
      const name = "lazy";

      const first = await t.mutation(api.batched.limit, { name, config });
      expect(first.ok).toBe(true);
      expect(first.retryAfter).toBe(undefined);

      // Queued, not yet applied.
      const queued = await t.run((ctx) =>
        ctx.db.query("pendingUpdates").collect(),
      );
      expect(queued).toHaveLength(1);
      expect(queued[0].count).toBe(1);
      const beforeWorker = await t.run((ctx) =>
        ctx.db.query("rateLimits").collect(),
      );
      expect(beforeWorker).toHaveLength(0);

      await drainWorker(t);

      const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
      expect(limits).toHaveLength(1);
      expect(limits[0].shard).toBe(0);
      expect(limits[0].value).toBe(9);
      // The worker cleans up what it applied.
      const drained = await t.run((ctx) =>
        ctx.db.query("pendingUpdates").collect(),
      );
      expect(drained).toHaveLength(0);
    });

    test("queued updates count against the limit before they're applied", async () => {
      const t = initConvexTest();
      const name = "burst";

      // The worker never runs, so nothing is folded into `rateLimits`. The
      // checks still see the consumption because they read the queue.
      for (let i = 0; i < 10; i++) {
        const result = await t.mutation(api.batched.limit, { name, config });
        expect(result.ok).toBe(true);
      }
      const exhausted = await t.mutation(api.batched.limit, { name, config });
      expect(exhausted.ok).toBe(false);
      expect(exhausted.retryAfter).toBeGreaterThan(0);

      // The rejected call queued nothing.
      const queued = await t.run((ctx) =>
        ctx.db.query("pendingUpdates").collect(),
      );
      expect(queued).toHaveLength(10);
    });

    test("the limit stays exhausted after the worker applies the batch", async () => {
      const t = initConvexTest();
      const name = "exhausted";

      for (let i = 0; i < 10; i++) {
        await t.mutation(api.batched.limit, { name, config });
      }
      await drainWorker(t);

      const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
      expect(limits).toHaveLength(1);
      expect(limits[0].value).toBe(0);

      const after = await t.mutation(api.batched.limit, { name, config });
      expect(after.ok).toBe(false);
      expect(after.retryAfter).toBeGreaterThan(0);
    });

    test("one write per limit no matter how many updates", async () => {
      const t = initConvexTest();
      const name = "aggregated";

      for (let i = 0; i < 4; i++) {
        await t.mutation(api.batched.limit, {
          name,
          key: "a",
          count: 2,
          config,
        });
        await t.mutation(api.batched.limit, { name, key: "b", config });
      }
      await drainWorker(t);

      const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
      expect(limits).toHaveLength(2);
      const byKey = Object.fromEntries(limits.map((l) => [l.key, l.value]));
      expect(byKey["a"]).toBe(2); // 10 - 4 * 2
      expect(byKey["b"]).toBe(6); // 10 - 4 * 1
    });

    test("check doesn't consume", async () => {
      const t = initConvexTest();
      const name = "checked";

      const before = await t.query(api.batched.check, { name, config });
      expect(before.ok).toBe(true);
      const queued = await t.run((ctx) =>
        ctx.db.query("pendingUpdates").collect(),
      );
      expect(queued).toHaveLength(0);

      await t.mutation(api.batched.limit, { name, count: 10, config });
      const after = await t.query(api.batched.check, { name, config });
      expect(after.ok).toBe(false);
      expect(after.retryAfter).toBeGreaterThan(0);
    });

    test("throws opts into a ConvexError", async () => {
      const t = initConvexTest();
      const name = "throwing";

      await t.mutation(api.batched.limit, { name, count: 10, config });
      const error = await t
        .mutation(api.batched.limit, { name, config, throws: true })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(isRateLimitError(error)).toBe(true);
      expect((error as { data: RateLimitError }).data).toMatchObject({
        kind: "RateLimited",
        name,
      });
    });

    test("getValue subtracts what's still queued", async () => {
      const t = initConvexTest();
      const name = "valued";

      await t.mutation(api.batched.limit, { name, count: 4, config });
      const queuedValue = await t.query(api.lib.getValue, { name, config });
      expect(queuedValue.value).toBe(6);

      await drainWorker(t);
      const appliedValue = await t.query(api.lib.getValue, { name, config });
      expect(appliedValue.value).toBe(6);
    });

    test("reset drops queued updates too", async () => {
      const t = initConvexTest();
      const name = "reset";

      await t.mutation(api.batched.limit, { name, count: 10, config });
      expect((await t.query(api.batched.check, { name, config })).ok).toBe(
        false,
      );

      await t.mutation(api.lib.resetRateLimit, { name });
      expect(
        await t.run((ctx) => ctx.db.query("pendingUpdates").collect()),
      ).toHaveLength(0);
      expect((await t.query(api.batched.check, { name, config })).ok).toBe(
        true,
      );

      // Nothing left to apply, so draining doesn't resurrect the consumption.
      await drainWorker(t);
      expect((await t.query(api.batched.check, { name, config })).ok).toBe(
        true,
      );
    });

    test("reserve hands back a retryAfter instead of rejecting", async () => {
      const t = initConvexTest();
      const name = "reserved";

      await t.mutation(api.batched.limit, { name, count: 10, config });
      const reserved = await t.mutation(api.batched.limit, {
        name,
        count: 5,
        reserve: true,
        config,
      });
      expect(reserved.ok).toBe(true);
      expect(reserved.retryAfter).toBeGreaterThan(0);

      await drainWorker(t);
      const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
      expect(limits[0].value).toBe(-5);
    });

    test("a non-lazy config is rejected", async () => {
      const t = initConvexTest();
      const { lazy: _lazy, ...eager } = config;
      await expect(
        t.mutation(api.batched.limit, {
          name: "eager",
          config: eager as RateLimitConfigValue,
        }),
      ).rejects.toThrow(/isn't lazy/);
    });

    test("sharding a lazy limit is rejected", async () => {
      const t = initConvexTest();
      await expect(
        t.mutation(api.batched.limit, {
          name: "sharded",
          config: { ...config, shards: 4 } as RateLimitConfigValue,
        }),
      ).rejects.toThrow(/can't be sharded/);
    });
  },
);

describe("lazy rate limits, independent of kind", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("keys are applied independently", async () => {
    const t = initConvexTest();
    const config = {
      kind: "token bucket",
      rate: 2,
      period: Minute,
      lazy: true,
    } as RateLimitConfigValue;

    await t.mutation(api.batched.limit, { name: "perKey", key: "a", config });
    await t.mutation(api.batched.limit, { name: "perKey", key: "a", config });
    const aExhausted = await t.query(api.batched.check, {
      name: "perKey",
      key: "a",
      config,
    });
    expect(aExhausted.ok).toBe(false);
    const bFresh = await t.query(api.batched.check, {
      name: "perKey",
      key: "b",
      config,
    });
    expect(bFresh.ok).toBe(true);
  });

  test("tokens replenish once consumption has been applied", async () => {
    const t = initConvexTest();
    const name = "replenish";
    const config = {
      kind: "token bucket",
      rate: 1,
      period: Minute,
      lazy: true,
    } as RateLimitConfigValue;

    await t.mutation(api.batched.limit, { name, config });
    await drainWorker(t);
    const [limit] = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(limit.value).toBe(0);

    // Line the clock up with when the worker applied the batch, so the elapsed
    // time is exactly what we advance by.
    vi.setSystemTime(limit.ts);
    expect((await t.query(api.batched.check, { name, config })).ok).toBe(false);

    vi.advanceTimersByTime(Minute);
    expect((await t.query(api.batched.check, { name, config })).ok).toBe(true);
  });
});

describe("queue accounting edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a big capacity consumed in small amounts isn't under-counted", async () => {
    const t = initConvexTest();
    const name = "manySmall";
    const config = {
      kind: "token bucket",
      rate: 10_000,
      period: Minute,
      lazy: true,
    } as RateLimitConfigValue;

    // More queued rows than a read used to look at, but nowhere near capacity,
    // so the scan has to walk all of them to get the right answer.
    for (let i = 0; i < 300; i++) {
      await t.mutation(api.batched.limit, { name, config });
    }
    expect((await t.query(api.lib.getValue, { name, config })).value).toBe(
      10_000 - 300,
    );

    // The worker walks all 300 across several batches. (Their effect on the
    // stored value isn't assertable here: draining jumps the fake clock minutes
    // per batch, which refills a bucket this size between them.)
    await drainWorker(t);
    expect(
      await t.run((ctx) => ctx.db.query("pendingUpdates").collect()),
    ).toHaveLength(0);
  });

  test("a queue far past the limit still rejects", async () => {
    const t = initConvexTest();
    const name = "wayOver";
    const config = {
      kind: "token bucket",
      rate: 10,
      period: Minute,
      lazy: true,
    } as RateLimitConfigValue;

    for (let i = 0; i < 5; i++) {
      await t.mutation(api.batched.limit, {
        name,
        count: 10,
        reserve: true,
        config,
      });
    }
    // The scan stops early once the queue passes what the limit could grant,
    // but the answer it needs — "no capacity" — is unaffected.
    expect((await t.query(api.batched.check, { name, config })).ok).toBe(false);
  });

  test("resetting mid-batch doesn't charge the reset limit or wedge the loop", async () => {
    const t = initConvexTest();
    const name = "resetRace";
    const config = {
      kind: "token bucket",
      rate: 10,
      period: Minute,
      lazy: true,
    } as RateLimitConfigValue;

    await t.mutation(api.batched.limit, { name, count: 8, config });

    // Hand out a batch the way the worker's loop does, then reset underneath it
    // before it gets applied.
    const batch = await t.query(internal.worker.getBatch, {
      name: "rateLimitUpdates",
    });
    expect(batch.kind).toBe("work");
    await t.mutation(api.lib.resetRateLimit, { name });

    // Applying the stale batch must not throw on the vanished rows...
    await t.mutation(internal.worker.applyBatch, {
      updates: batch.kind === "work" ? batch.batch.updates : [],
    });
    // ...nor charge consumption to the limit that was just reset.
    expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toEqual(
      [],
    );
    expect((await t.query(api.batched.check, { name, config })).ok).toBe(true);
  });
});

// `async`/`stale` are per-call flags, so nothing stops a limit being consumed
// both ways. These pin down what that costs, since it's the one thing a caller
// has to get right on its own.
describe("mixing synchronous and asynchronous consumption", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A long period, so the clock jump `drainWorker` causes doesn't replenish
  // enough to hide the over-admission.
  const config = {
    kind: "token bucket",
    rate: 10,
    period: 60 * Minute,
  } as RateLimitConfigValue;
  const asyncConfig = { ...config, lazy: true } as RateLimitConfigValue;

  test("a synchronous call ignores queued consumption and over-admits", async () => {
    const t = initConvexTest();
    const name = "mixed";

    // Use the whole limit asynchronously.
    await t.mutation(api.batched.limit, {
      name,
      count: 10,
      config: asyncConfig,
    });
    expect(
      (await t.query(api.batched.check, { name, config: asyncConfig })).ok,
    ).toBe(false);

    // A synchronous call reads only the stored value, which the worker hasn't
    // written yet, so it sees a full limit and admits.
    const sync = await t.mutation(api.lib.rateLimit, {
      name,
      count: 10,
      config,
    });
    expect(sync.ok).toBe(true);

    // 20 tokens admitted from a limit of 10. Once the worker catches up the debt
    // is real, so it self-corrects rather than compounding.
    await drainWorker(t);
    const [limit] = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(limit.value).toBeLessThan(0);
  });

  test("a non-stale check ignores queued consumption too", async () => {
    const t = initConvexTest();
    const name = "mixedCheck";

    await t.mutation(api.batched.limit, {
      name,
      count: 10,
      config: asyncConfig,
    });
    // Same limit, same instant: the stale check sees the queue, the plain one
    // doesn't. This is why `stale` has to be used consistently.
    expect(
      (await t.query(api.batched.check, { name, config: asyncConfig })).ok,
    ).toBe(false);
    expect((await t.query(api.lib.checkRateLimit, { name, config })).ok).toBe(
      true,
    );
  });
});

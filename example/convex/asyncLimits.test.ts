import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Run the batch worker to completion, then wind the fake clock back. */
async function drainWorker(t: ReturnType<typeof initConvexTest>) {
  const now = Date.now();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.setSystemTime(now);
}

test("consumption is applied in the background", async () => {
  const t = initConvexTest();

  const first = await t.mutation(api.asyncLimits.consumeTokens, {
    count: 4_000,
  });
  expect(first.ok).toBe(true);

  // Not applied yet, but already reflected in what's left.
  expect((await t.query(api.asyncLimits.remainingTokens, {})).value).toBe(
    6_000,
  );

  await drainWorker(t);
  expect((await t.query(api.asyncLimits.remainingTokens, {})).value).toBe(
    6_000,
  );
});

test("checks see queued consumption from both queries and mutations", async () => {
  const t = initConvexTest();

  await t.mutation(api.asyncLimits.consumeTokens, { count: 10_000 });

  expect((await t.query(api.asyncLimits.checkFromQuery, {})).ok).toBe(false);
  expect(
    (await t.mutation(internal.asyncLimits.checkFromMutation, {})).ok,
  ).toBe(false);

  await drainWorker(t);

  expect((await t.query(api.asyncLimits.checkFromQuery, {})).ok).toBe(false);
  expect(
    (await t.mutation(internal.asyncLimits.checkFromMutation, {})).ok,
  ).toBe(false);
});

test("concurrent consumers of one limit don't step on each other", async () => {
  const t = initConvexTest();

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      t.mutation(api.asyncLimits.consumeTokens, { count: 500 }).catch(() => ({
        ok: false as const,
        error: i,
      })),
    ),
  );
  // 20 * 500 is exactly the budget, and nothing failed with a conflict.
  expect(results.every((r) => r.ok)).toBe(true);

  await drainWorker(t);
  expect((await t.query(api.asyncLimits.remainingTokens, {})).value).toBe(0);
  expect((await t.query(api.asyncLimits.checkFromQuery, {})).ok).toBe(false);
});

test("keys are limited separately", async () => {
  const t = initConvexTest();

  for (let i = 0; i < 60; i++) {
    expect((await t.mutation(api.asyncLimits.search, { user: "ann" })).ok).toBe(
      true,
    );
  }
  expect((await t.mutation(api.asyncLimits.search, { user: "ann" })).ok).toBe(
    false,
  );
  expect((await t.mutation(api.asyncLimits.search, { user: "bob" })).ok).toBe(
    true,
  );
});

test("reset clears applied and queued consumption alike", async () => {
  const t = initConvexTest();

  await t.mutation(api.asyncLimits.consumeTokens, { count: 10_000 });
  await drainWorker(t);
  await t.mutation(api.asyncLimits.consumeTokens, { count: 1 });
  expect((await t.query(api.asyncLimits.checkFromQuery, {})).ok).toBe(false);

  await t.mutation(api.asyncLimits.reset, {});
  expect((await t.query(api.asyncLimits.checkFromQuery, {})).ok).toBe(true);

  await drainWorker(t);
  expect((await t.query(api.asyncLimits.checkFromQuery, {})).ok).toBe(true);
});

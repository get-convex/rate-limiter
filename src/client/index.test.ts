import { expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import {
  isRateLimitError,
  RateLimiter,
  SECOND,
  type MutationCtx,
  type RateLimitError,
} from "./index.js";
import type { ComponentApi } from "../component/_generated/component.js";

const component = {
  lib: { resetRateLimit: "lib:resetRateLimit" },
} as unknown as ComponentApi;

function mutationCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn().mockResolvedValue(null),
  } satisfies MutationCtx;
}
test("isRateLimitError", () => {
  expect(
    isRateLimitError(
      new ConvexError({
        kind: "RateLimited",
        name: "foo",
        retryAfter: 1,
      } as RateLimitError),
    ),
  ).toBe(true);
  expect(isRateLimitError(new ConvexError({ kind: "foo" }))).toBe(false);
});

test("reset without a value doesn't need a config", async () => {
  const rateLimiter = new RateLimiter(component);
  const ctx = mutationCtx();
  await rateLimiter.reset(ctx, "anyName", { key: "key" });
  expect(ctx.runMutation).toHaveBeenCalledWith(component.lib.resetRateLimit, {
    name: "anyName",
    key: "key",
  });
});

test("reset to a value sends the named config", async () => {
  const config = { kind: "token bucket", rate: 10, period: SECOND } as const;
  const rateLimiter = new RateLimiter(component, { sendMessage: config });
  const ctx = mutationCtx();
  await rateLimiter.reset(ctx, "sendMessage", { to: 0 });
  expect(ctx.runMutation).toHaveBeenCalledWith(component.lib.resetRateLimit, {
    name: "sendMessage",
    key: undefined,
    to: 0,
    config,
  });
});

test("reset to a value sends an inline config", async () => {
  const config = { kind: "fixed window", rate: 10, period: SECOND } as const;
  const rateLimiter = new RateLimiter(component);
  const ctx = mutationCtx();
  await rateLimiter.reset(ctx, "oneOffName", { to: 3, config });
  expect(ctx.runMutation).toHaveBeenCalledWith(component.lib.resetRateLimit, {
    name: "oneOffName",
    key: undefined,
    to: 3,
    config,
  });
});

test("reset to a value without any config throws", async () => {
  const rateLimiter = new RateLimiter(component);
  const ctx = mutationCtx();
  await expect(rateLimiter.reset(ctx, "oneOffName", { to: 0 })).rejects.toThrow(
    "not defined",
  );
});

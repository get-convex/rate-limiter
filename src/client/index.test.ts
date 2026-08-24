import { expect, test } from "vitest";
import { ConvexError } from "convex/values";
import {
  isRateLimitError,
  RateLimiter,
  type RateLimitConfig,
  type RateLimitError,
} from "./index.js";
import type { ComponentApi } from "../component/_generated/component.js";

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

test("config types", () => {
  const component = null as unknown as ComponentApi;

  const rateLimiter = new RateLimiter(component, {
    plain: { kind: "token bucket", rate: 1, period: 1000 },
    sharded: { kind: "token bucket", rate: 1, period: 1000, shards: 4 },
    lazy: { kind: "fixed window", rate: 1, period: 1000, lazy: true },
  });
  // Defined names don't need an inline config, lazy or not. Never called —
  // this is here for the type checker.
  async function callsWithoutInlineConfig() {
    await rateLimiter.check(null as never, "plain");
    await rateLimiter.check(null as never, "lazy");
    await rateLimiter.limit(null as never, "sharded");
  }

  new RateLimiter(component, {
    // @ts-expect-error a lazy rate limit can't also be sharded
    both: {
      kind: "token bucket",
      rate: 1,
      period: 1000,
      lazy: true,
      shards: 4,
    },
  });

  // A config whose `kind` isn't narrowed to one literal still fits.
  const kind = "token bucket" as "token bucket" | "fixed window";
  const eitherKind: RateLimitConfig = { kind, rate: 1, period: 1000 };

  expect(callsWithoutInlineConfig).toBeInstanceOf(Function);
  expect(eitherKind.rate).toBe(1);
});

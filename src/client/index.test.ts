import { expect, test } from "vitest";
import { ConvexError } from "convex/values";
import {
  isRateLimitError,
  LazyRateLimiter,
  RateLimiter,
  type LazyRateLimitConfig,
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
  });
  const lazyRateLimiter = new LazyRateLimiter(component, {
    lazy: { kind: "fixed window", rate: 1, period: 1000 },
  });

  // Defined names don't need an inline config. Never called — this is here for
  // the type checker.
  async function callsWithoutInlineConfig() {
    await rateLimiter.check(null as never, "plain");
    await rateLimiter.limit(null as never, "sharded");
    await lazyRateLimiter.check(null as never, "lazy");
    await lazyRateLimiter.limit(null as never, "lazy");
  }

  // Undefined names still have to bring one.
  async function unknownNamesNeedConfig() {
    // @ts-expect-error an unknown name requires an inline config
    await rateLimiter.limit(null as never, "unknown", {});
    // @ts-expect-error an unknown name requires an inline config
    await lazyRateLimiter.limit(null as never, "unknown", {});
  }

  // Neither client accepts the other's option.
  new RateLimiter(component, {
    // @ts-expect-error `lazy` belongs on a LazyRateLimiter
    wrong: { kind: "token bucket", rate: 1, period: 1000, lazy: true },
  });
  new LazyRateLimiter(component, {
    // @ts-expect-error a lazy rate limit can't be sharded
    wrong: { kind: "token bucket", rate: 1, period: 1000, shards: 4 },
  });

  // ...and an annotated config is checked the same way, with no client in sight.
  const annotated: LazyRateLimitConfig = {
    kind: "token bucket",
    rate: 1,
    period: 1000,
    // @ts-expect-error `shards` isn't a field on a lazy config
    shards: 4,
  };

  // A config whose `kind` isn't narrowed to one literal still fits both.
  const kind = "token bucket" as "token bucket" | "fixed window";
  const eitherKind: RateLimitConfig = { kind, rate: 1, period: 1000 };
  const eitherKindLazy: LazyRateLimitConfig = { kind, rate: 1, period: 1000 };

  expect(callsWithoutInlineConfig).toBeInstanceOf(Function);
  expect(unknownNamesNeedConfig).toBeInstanceOf(Function);
  expect(annotated.rate).toBe(1);
  expect(eitherKind.rate).toBe(1);
  expect(eitherKindLazy.rate).toBe(1);
});

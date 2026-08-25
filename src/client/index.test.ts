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

test("config and option types", () => {
  const component = null as unknown as ComponentApi;

  const rateLimiter = new RateLimiter(component, {
    plain: { kind: "token bucket", rate: 1, period: 1000 },
    sharded: { kind: "token bucket", rate: 1, period: 1000, shards: 4 },
  });

  // Never called — these are here for the type checker.
  async function calls() {
    // A defined name doesn't need an inline config.
    await rateLimiter.check(null as never, "plain");
    await rateLimiter.limit(null as never, "plain");

    // Either mode is available on an unsharded limit.
    await rateLimiter.limit(null as never, "plain", { async: true });
    await rateLimiter.check(null as never, "plain", { stale: true });
    await rateLimiter.getValue(null as never, "plain", { stale: true });

    // ...and on an inline config, where the component does the checking.
    await rateLimiter.limit(null as never, "adhoc", {
      async: true,
      config: { kind: "fixed window", rate: 1, period: 1000 },
    });

    // A sharded limit is spread over documents the worker never writes, so it
    // can't be consumed asynchronously.
    // @ts-expect-error `async` is not available on a sharded limit
    await rateLimiter.limit(null as never, "sharded", { async: true });
    // @ts-expect-error `stale` is not available on a sharded limit
    await rateLimiter.check(null as never, "sharded", { stale: true });
    // @ts-expect-error `stale` is not available on a sharded limit
    await rateLimiter.getValue(null as never, "sharded", { stale: true });

    // Explicitly opting out is still fine on a sharded limit.
    await rateLimiter.limit(null as never, "sharded", { async: undefined });

    // @ts-expect-error an unknown name still requires an inline config
    await rateLimiter.limit(null as never, "unknown", { async: true });
  }

  // A config whose `kind` isn't narrowed to one literal still fits.
  const kind = "token bucket" as "token bucket" | "fixed window";
  const eitherKind: RateLimitConfig = { kind, rate: 1, period: 1000 };

  expect(calls).toBeInstanceOf(Function);
  expect(eitherKind.rate).toBe(1);
});

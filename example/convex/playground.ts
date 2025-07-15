import { RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { fixedWindowValidator, tokenBucketValidator } from "../../src/shared";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

const rateLimiter = new RateLimiter(components.rateLimiter);

// Used to power the playground UI which lets you play with the config
export const { getRateLimit, getServerTime } = rateLimiter.hookAPI("demo", {
  config: { kind: "token bucket", rate: 1, period: 2_000, capacity: 3 },
});

export const consumeRateLimit = mutation({
  args: {
    config: v.union(tokenBucketValidator, fixedWindowValidator),
    count: v.number(),
    reserve: v.boolean(),
  },
  handler: async (ctx, args) => {
    return rateLimiter.limit(ctx, "demo", {
      config: args.config,
      count: args.count,
      reserve: args.reserve,
    });
  },
});

export const resetRateLimit = mutation({
  args: {},
  handler: async (ctx) => {
    return rateLimiter.reset(ctx, "demo");
  },
});

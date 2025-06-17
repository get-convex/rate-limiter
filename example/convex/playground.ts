import { RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { fixedWindowValidator, tokenBucketValidator } from "../../src/shared";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const rateLimiter = new RateLimiter(components.rateLimiter);

// Used to power the playground UI which lets you play with the config
export const getValue = query({
  args: { config: v.union(tokenBucketValidator, fixedWindowValidator) },
  handler: async (ctx, args) => {
    return rateLimiter.getValue(ctx, "demo", { config: args.config });
  },
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

export const getServerTime = mutation({
  args: {},
  handler: async () => {
    return Date.now();
  },
});

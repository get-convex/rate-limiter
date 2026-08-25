import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";

// These limits are consumed asynchronously: every call below passes
// `async`/`stale`, so consumption is queued for a batch worker and any number of
// requests can share one limit without the write conflicts you'd get from all of
// them updating the same document.
//
// Nothing enforces that, so it's on us to keep it consistent per limit — one
// synchronous call would both over-admit and start conflicting with the worker.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  // A global budget on an expensive shared resource, hit from everywhere.
  llmTokens: { kind: "token bucket", rate: 10_000, period: MINUTE },
  // Per-user, and async here too: hot keys don't contend either.
  search: { kind: "fixed window", rate: 60, period: MINUTE },
});

export const consumeTokens = mutation({
  args: { count: v.number() },
  handler: (ctx, { count }) =>
    rateLimiter.limit(ctx, "llmTokens", { count, async: true }),
});

export const search = mutation({
  args: { user: v.string() },
  handler: (ctx, { user }) =>
    rateLimiter.limit(ctx, "search", { key: user, async: true }),
});

// `stale` accounts for consumption that's queued but not yet applied. From a
// mutation it also reads off a recent snapshot, so checking the limit doesn't
// make this transaction conflict with everyone else consuming it.
export const checkFromMutation = internalMutation({
  args: { count: v.optional(v.number()) },
  handler: (ctx, { count }) =>
    rateLimiter.check(ctx, "llmTokens", { count, stale: true }),
});

export const checkFromQuery = query({
  args: { count: v.optional(v.number()) },
  handler: (ctx, { count }) =>
    rateLimiter.check(ctx, "llmTokens", { count, stale: true }),
});

export const remainingTokens = query({
  args: {},
  handler: (ctx) => rateLimiter.getValue(ctx, "llmTokens", { stale: true }),
});

export const reset = mutation({
  args: {},
  handler: (ctx) => rateLimiter.reset(ctx, "llmTokens"),
});

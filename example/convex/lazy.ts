import { LazyRateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";

// A LazyRateLimiter checks each limit against a recent snapshot and consumes it
// in the background, so any number of requests can share one limit without the
// write conflicts you'd get from all of them updating the same document.
const rateLimiter = new LazyRateLimiter(components.rateLimiter, {
  // A global budget on an expensive shared resource, hit from everywhere.
  llmTokens: { kind: "token bucket", rate: 10_000, period: MINUTE },
  // Per-user, and lazy here too: hot keys don't contend either.
  search: { kind: "fixed window", rate: 60, period: MINUTE },
});

export const consumeTokens = mutation({
  args: { count: v.number() },
  handler: (ctx, { count }) => rateLimiter.limit(ctx, "llmTokens", { count }),
});

export const search = mutation({
  args: { user: v.string() },
  handler: (ctx, { user }) => rateLimiter.limit(ctx, "search", { key: user }),
});

// Checking from a mutation reads the limit off a recent snapshot, so it doesn't
// make this transaction conflict with everyone else consuming the limit.
export const checkFromMutation = internalMutation({
  args: { count: v.optional(v.number()) },
  handler: (ctx, { count }) => rateLimiter.check(ctx, "llmTokens", { count }),
});

export const checkFromQuery = query({
  args: { count: v.optional(v.number()) },
  handler: (ctx, { count }) => rateLimiter.check(ctx, "llmTokens", { count }),
});

export const remainingTokens = query({
  args: {},
  handler: (ctx) => rateLimiter.getValue(ctx, "llmTokens"),
});

export const reset = mutation({
  args: {},
  handler: (ctx) => rateLimiter.reset(ctx, "llmTokens"),
});

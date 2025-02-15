import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { rateLimitArgs, rateLimitReturns } from "../shared.js";
import { checkRateLimitOrThrow } from "./internal.js";
import { api } from "./_generated/api.js";

export const rateLimit = mutation({
  args: rateLimitArgs,
  returns: rateLimitReturns,
  handler: async (ctx, args) => {
    const { status, updates } = await checkRateLimitOrThrow(ctx.db, args);
    for (const { value, ts, existing, shard } of updates) {
      if (existing) {
        await ctx.db.patch(existing._id, { ts, value });
      } else {
        const { name, key: optionalKey } = args;
        const key = optionalKey;
        await ctx.db.insert("rateLimits", { name, key, ts, value, shard });
      }
    }
    return status;
  },
});

export const checkRateLimit = query({
  args: rateLimitArgs,
  returns: rateLimitReturns,
  handler: async (ctx, args) => {
    const { status } = await checkRateLimitOrThrow(ctx.db, args);
    return status;
  },
});

export const resetRateLimit = mutation({
  args: {
    name: v.string(),
    key: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const allShards = await ctx.db
      .query("rateLimits")
      .withIndex("name", (q) => q.eq("name", args.name).eq("key", args.key))
      .collect();
    for (const shard of allShards) {
      await ctx.db.delete(shard._id);
    }
  },
});

export const clearAll = mutation({
  args: { before: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("rateLimits")
      .withIndex("by_creation_time", (q) =>
        q.lte("_creationTime", args.before ?? Date.now())
      )
      .order("desc")
      .take(100);
    for (const m of results) {
      await ctx.db.delete(m._id);
    }
    if (results.length === 100) {
      await ctx.scheduler.runAfter(0, api.lib.clearAll, {
        before: results[99]._creationTime,
      });
    }
  },
});

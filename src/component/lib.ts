import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { rateLimitArgs, rateLimitReturns } from "../shared.js";
import { checkRateLimitOrThrow, getShard } from "./internal.js";
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

export const getValue = query({
  args: {
    ...rateLimitArgs,
    sampleShards: v.optional(v.number()),
  },
  returns: v.object({
    value: v.number(),
    ts: v.number(),
    windowStart: v.optional(v.number()),
    config: v.object({
      kind: v.union(v.literal("token bucket"), v.literal("fixed window")),
      rate: v.number(),
      period: v.number(),
      capacity: v.optional(v.number()),
      maxReserved: v.optional(v.number()),
      shards: v.optional(v.number()),
      start: v.optional(v.number()),
    }),
  }),
  handler: async (ctx, args) => {
    const { sampleShards, ...rateLimitArgs } = args;
    const shards = Math.round(args.config.shards || 1);
    const samplesToTake = Math.min(sampleShards ?? 1, shards);
    
    const shardIndices = Array.from({ length: shards }, (_, i) => i);
    const selectedShards = [];
    
    for (let i = 0; i < samplesToTake; i++) {
      if (shardIndices.length === 0) break;
      const randomIndex = Math.floor(Math.random() * shardIndices.length);
      selectedShards.push(shardIndices[randomIndex]);
      shardIndices.splice(randomIndex, 1);
    }
    
    const firstShard = await getShard(ctx.db, args.name, args.key, selectedShards[0] || 0);
    
    if (firstShard) {
      const windowStart = args.config.kind === "fixed window" 
        ? firstShard.ts 
        : undefined;
      
      return {
        value: firstShard.value,
        ts: firstShard.ts,
        windowStart,
        config: args.config,
      };
    }
    
    const max = args.config.capacity ?? args.config.rate;
    const windowStart = args.config.kind === "fixed window" 
      ? (args.config.start ?? Math.floor(Math.random() * args.config.period))
      : undefined;
    
    return {
      value: max,
      ts: args.config.kind === "fixed window" 
        ? (windowStart as number)
        : Date.now(),
      windowStart,
      config: args.config,
    };
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

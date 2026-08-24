import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import {
  calculateRateLimit,
  getValueReturns,
  rateLimitArgs,
  configValidator,
  rateLimitReturns,
  type GetValueReturns,
} from "../shared.js";
import {
  checkRateLimitOrThrow,
  configWithDefaults,
  getShard,
} from "./internal.js";
import { grantCeiling, queuedCount } from "./worker.js";
import { api } from "./_generated/api.js";

/** How many rows one cleanup pass deletes before rescheduling itself. */
const CLEANUP_BATCH = 100;

export const rateLimit = mutation({
  args: rateLimitArgs,
  returns: rateLimitReturns,
  handler: async (ctx, args) => {
    const { status, updates } = await checkRateLimitOrThrow(ctx.db, args);
    for (const { value, ts, existing, shard } of updates) {
      if (existing) {
        await ctx.db.patch("rateLimits", existing._id, { ts, value });
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
    name: v.string(),
    key: v.optional(v.string()),
    config: configValidator,
    sampleShards: v.optional(v.number()),
  },
  returns: getValueReturns,
  handler: async (ctx, args): Promise<GetValueReturns> => {
    const config = configWithDefaults(args.config);
    const samplesToTake = Math.min(args.sampleShards || 1, config.shards);

    const shardIndices = Array.from({ length: config.shards }, (_, i) => i);
    const selectedShards: number[] = [];

    for (let i = 0; i < samplesToTake; i++) {
      if (shardIndices.length === 0) break;
      const randomIndex = Math.floor(Math.random() * shardIndices.length);
      selectedShards.push(shardIndices[randomIndex]);
      shardIndices.splice(randomIndex, 1);
    }

    const allShards = (
      await Promise.all(
        selectedShards.map((shard) =>
          getShard(ctx.db, args.name, args.key, shard),
        ),
      )
    ).map(
      (state, i) =>
        state ?? { value: config.capacity, ts: 0, shard: selectedShards[i]! },
    );

    const maxTs = Math.max(...allShards.map((shard) => shard.ts));
    // we calculate the values as if each shard was at the latest ts
    // we avoid passing Date.now() so the query isn't too time-aware.
    const values = allShards.map((state) => ({
      ...state,
      maxTs: calculateRateLimit(state, config, maxTs),
    }));
    const maxShard = values.reduce((a, b) =>
      a.maxTs.value > b.maxTs.value ? a : b,
    );
    if (config.kind === "fixed window" && !config.start) {
      // we can modify here b/c config is our copy
      config.start = maxShard.maxTs.windowStart;
    }

    // Consumption the worker hasn't applied yet is real: subtract it from the
    // stored value so callers project forward from the same number the next
    // check would see.
    const queued = config.lazy
      ? await queuedCount(ctx, args.name, args.key, grantCeiling(config))
      : 0;

    return {
      value: maxShard.value - queued,
      ts: maxShard.ts,
      shard: maxShard.shard,
      config,
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
      await ctx.db.delete("rateLimits", shard._id);
    }
    // Drop consumption the worker hasn't applied yet, so it doesn't land on the
    // limit after it's been reset.
    const queued = await ctx.db
      .query("pendingUpdates")
      .withIndex("name_key_updatedAt", (q) =>
        q.eq("name", args.name).eq("key", args.key),
      )
      .take(CLEANUP_BATCH);
    for (const update of queued) {
      await ctx.db.delete("pendingUpdates", update._id);
    }
    if (queued.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, api.lib.resetRateLimit, args);
    }
  },
});

export const clearAll = mutation({
  args: { before: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const before = args.before ?? Date.now();
    const results = await ctx.db
      .query("rateLimits")
      .withIndex("by_creation_time", (q) => q.lte("_creationTime", before))
      .order("desc")
      .take(CLEANUP_BATCH);
    for (const m of results) {
      await ctx.db.delete("rateLimits", m._id);
    }
    const queued = await ctx.db
      .query("pendingUpdates")
      .withIndex("by_creation_time", (q) => q.lte("_creationTime", before))
      .order("desc")
      .take(CLEANUP_BATCH);
    for (const update of queued) {
      await ctx.db.delete("pendingUpdates", update._id);
    }
    // Only a full page means there's more of that table left to walk; a short
    // one is exhausted and doesn't constrain where the next pass starts. Take
    // the *newest* remaining cutoff: a lower one would skip everything the
    // other table still has above it.
    const cutoffs = [
      results.length === CLEANUP_BATCH ? results[CLEANUP_BATCH - 1] : undefined,
      queued.length === CLEANUP_BATCH ? queued[CLEANUP_BATCH - 1] : undefined,
    ].filter((doc) => doc !== undefined);
    if (cutoffs.length > 0) {
      await ctx.scheduler.runAfter(0, api.lib.clearAll, {
        before: Math.max(...cutoffs.map((doc) => doc._creationTime)),
      });
    }
  },
});

export { getServerTime } from "./time.js";

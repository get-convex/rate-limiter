import { v } from "convex/values";
import { ping, vBatchQueryArgs, vBatchResult } from "@convex-dev/batch-worker";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import {
  calculateRateLimit,
  configValidator,
  type RateLimitConfig,
} from "../shared.js";
import { configWithDefaults, getShard, MIN_CHOOSE_TWO } from "./internal.js";

const vShardConsumption = v.object({
  shard: v.number(),
  count: v.number(),
});

// One worker drains every named/keyed limit's consumption together. The `name`
// here is the batch-worker queue name, not a rate limit name.
const WORKER_NAME = "rateLimiter";

// How many queued consumption rows to apply per worker mutation. Anything left
// over is drained immediately (the worker mutation returns nothing).
const BATCH_SIZE = 100;

// Wait this long after the queue goes from idle->active so a burst of
// consumption accumulates into a single pass over the rate limits.
const DEBOUNCE_MS = 500;

const vConsumption = v.object({
  id: v.id("consumption"),
  name: v.string(),
  key: v.optional(v.string()),
  shard: v.number(),
  count: v.number(),
  config: configValidator,
});

const vBatchedCheckReturns = v.union(
  v.object({
    ok: v.literal(true),
    retryAfter: v.optional(v.number()),
    updates: v.array(vShardConsumption),
  }),
  v.object({
    ok: v.literal(false),
    retryAfter: v.number(),
    updates: v.array(vShardConsumption),
  }),
);

/**
 * Append a unit of consumption to the queue and make sure the worker loop is
 * running. This mutation only inserts — it never reads `rateLimits` — so it
 * never OCC-conflicts with the worker that's applying consumption.
 */
export const push = mutation({
  args: {
    name: v.string(),
    key: v.optional(v.string()),
    updates: v.array(vShardConsumption),
    config: configValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.insert("consumption", {
        name: args.name,
        key: args.key,
        shard: update.shard,
        count: update.count,
        config: args.config,
      });
    }
    await ping(ctx, components.batchWorker, {
      name: WORKER_NAME,
      workQuery: internal.batched.getBatch,
      workerMutation: internal.batched.applyBatch,
      config: { debounceMs: DEBOUNCE_MS },
    });
  },
});

/**
 * Snapshot admission query for the lazy API. It reads all shards for the
 * limit, picks the highest-value one or two, and returns the shard writes the
 * enqueue mutation should append. The caller is responsible for running this
 * with a stale snapshot so it doesn't add OCC read dependencies.
 */
export const check = query({
  args: {
    name: v.string(),
    key: v.optional(v.string()),
    count: v.optional(v.number()),
    config: configValidator,
  },
  returns: vBatchedCheckReturns,
  handler: async (ctx, args) => {
    const config = configWithDefaults(args.config);
    validateBatchedRequest(args.name, args.count ?? 1, config);

    const shardConfig = configForShard(config);
    const docs = await ctx.db
      .query("rateLimits")
      .withIndex("name", (q) => q.eq("name", args.name).eq("key", args.key))
      .collect();
    const docsByShard = new Map(docs.map((doc) => [doc.shard, doc]));
    const now = Date.now();
    const shards = Array.from({ length: config.shards }, (_, shard) => {
      const existing = docsByShard.get(shard) ?? null;
      const current = calculateRateLimit(existing, shardConfig, now);
      return { shard, existing, value: current.value };
    }).sort((a, b) => b.value - a.value || a.shard - b.shard);

    const count = args.count ?? 1;
    const first = shards[0]!;
    const firstResult = calculateRateLimit(
      first.existing,
      shardConfig,
      now,
      count,
    );
    // We always return the shard writes we *would* apply, even when the limit
    // is exceeded. The caller decides whether to enqueue them: it only does so
    // if `ok`, unless it passed `reserve`, in which case it enqueues regardless.
    if (firstResult.value >= 0 || config.shards < MIN_CHOOSE_TWO) {
      const updates = [{ shard: first.shard, count }];
      return firstResult.value >= 0
        ? { ok: true as const, retryAfter: firstResult.retryAfter, updates }
        : { ok: false as const, retryAfter: firstResult.retryAfter!, updates };
    }

    const second = shards[1]!;
    const targetValue = (first.value + second.value - count) / 2;
    const firstCount = first.value - targetValue;
    const secondCount = count - firstCount;
    const firstShared = calculateRateLimit(
      first.existing,
      shardConfig,
      now,
      firstCount,
    );
    const secondShared = calculateRateLimit(
      second.existing,
      shardConfig,
      now,
      secondCount,
    );
    // Split across both shards to keep them balanced, but keep the total equal
    // to `count` — if the balancing math would put nothing on the second shard,
    // put the whole request on the first.
    const updates =
      secondCount > 0
        ? [
            { shard: first.shard, count: firstCount },
            { shard: second.shard, count: secondCount },
          ]
        : [{ shard: first.shard, count }];
    const retryAfter =
      firstShared.retryAfter === undefined &&
      secondShared.retryAfter === undefined
        ? undefined
        : Math.max(firstShared.retryAfter ?? 0, secondShared.retryAfter ?? 0);
    if (firstShared.value >= 0 && secondShared.value >= 0) {
      return { ok: true as const, retryAfter, updates };
    }
    return { ok: false as const, retryAfter: retryAfter ?? 0, updates };
  },
});

/**
 * Work query: hand the next batch of queued consumption to the worker, or go
 * idle when the queue is empty. Uses a snapshot read, so concurrent `push`
 * inserts don't cause the loop to retry.
 */
export const getBatch = internalQuery({
  args: vBatchQueryArgs,
  returns: vBatchResult(v.object({ items: v.array(vConsumption) })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("consumption").take(BATCH_SIZE);
    if (rows.length === 0) {
      return { kind: "idle" as const };
    }
    return {
      kind: "work" as const,
      batch: {
        items: rows.map((r) => ({
          id: r._id,
          name: r.name,
          key: r.key,
          shard: r.shard,
          count: r.count,
          config: r.config,
        })),
      },
    };
  },
});

/**
 * Worker mutation: apply a batch of queued consumption to the rate limits. All
 * consumption for the same (name, key, shard) is summed and applied in one
 * write. Returning nothing re-runs immediately to drain anything left.
 */
export const applyBatch = internalMutation({
  args: { items: v.array(vConsumption) },
  returns: v.null(),
  handler: async (ctx, { items }) => {
    // Group all queued consumption by the limit it targets.
    const groups = new Map<
      string,
      {
        name: string;
        key?: string;
        shard: number;
        count: number;
        config: (typeof items)[number]["config"];
      }
    >();
    for (const item of items) {
      const groupKey = `${item.name}\0${item.key ?? ""}\0${item.shard}`;
      const group = groups.get(groupKey);
      if (group) {
        group.count += item.count;
        group.config = item.config; // most recent config wins
      } else {
        groups.set(groupKey, {
          name: item.name,
          key: item.key,
          shard: item.shard,
          count: item.count,
          config: item.config,
        });
      }
    }

    const now = Date.now();
    for (const {
      name,
      key,
      shard,
      count,
      config: rawConfig,
    } of groups.values()) {
      const config = configForShard(configWithDefaults(rawConfig));
      const existing = await getShard(ctx.db, name, key, shard);
      // Apply unconditionally — the snapshot check already gated admission. The
      // value may go negative, which fairly delays future grants.
      const { value, ts } = calculateRateLimit(existing, config, now, count);
      if (existing) {
        await ctx.db.patch("rateLimits", existing._id, { value, ts });
      } else {
        await ctx.db.insert("rateLimits", {
          name,
          key,
          shard,
          value,
          ts,
        });
      }
    }

    for (const item of items) {
      await ctx.db.delete("consumption", item.id);
    }
  },
});

function configForShard(config: RequiredShardFields): RateLimitConfig {
  if (config.shards === 1) return config;
  const sharded = { ...config };
  sharded.rate /= config.shards;
  if (sharded.capacity) {
    sharded.capacity /= config.shards;
  }
  if (sharded.maxReserved) {
    sharded.maxReserved /= config.shards;
  }
  return sharded;
}

function validateBatchedRequest(
  name: string,
  count: number,
  config: RequiredShardFields,
) {
  if (config.shards <= 0) {
    throw new Error("Shards must be a positive number");
  }
  const shardFactor = config.shards < MIN_CHOOSE_TWO ? 1 : config.shards / 2;
  const max = config.capacity / shardFactor;
  if (count > max) {
    throw new Error(
      `Rate limit ${name} count ${count} exceeds ${max}` +
        (config.shards > 1 ? ` per ${config.shards} shards.` : "."),
    );
  }
}

type RequiredShardFields = RateLimitConfig & {
  shards: number;
  capacity: number;
};

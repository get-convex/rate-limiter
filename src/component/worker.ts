import { v } from "convex/values";
import { defineBatchWorkerValidators, ping } from "@convex-dev/batch-worker";
import { components, internal } from "./_generated/api.js";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import {
  calculateRateLimit,
  configValidator,
  SINGLETON_SHARD,
  type RateLimitConfigValue,
} from "../shared.js";
import { configWithDefaults, getShard } from "./internal.js";

/**
 * The batch worker that folds `pendingUpdates` into `rateLimits`. All lazy
 * limits share one loop, so there is exactly one writer to `rateLimits` for
 * them and they never conflict with each other.
 */
export const WORKER_NAME = "rateLimitUpdates";

/** How many queued updates one batch folds in. */
const BATCH_SIZE = 64;

/**
 * The most queued updates a single read of a lazy limit will walk. Reads
 * normally stop long before this, as soon as the queue exceeds what the limit
 * could grant; this only bites when a limit's capacity is larger than the
 * number of queued rows, i.e. many small consumptions against a big budget.
 * Past it a read under-counts, and admits more than it should.
 */
const MAX_PENDING_SCAN = 1024;

/** Make sure the loop that applies queued updates is running. */
export async function pingWorker(ctx: MutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: WORKER_NAME,
    workQuery: internal.worker.getBatch,
    workerMutation: internal.worker.applyBatch,
  });
}

/**
 * The tokens consumed for one limit that the worker hasn't applied yet.
 *
 * Bounded by the worker's cursor, so it doesn't scan past updates already
 * applied and deleted, and it stops reading once the queue passes `ceiling` —
 * the most the limit could ever hand out — since beyond that the caller rejects
 * either way and more precision buys nothing.
 */
export async function queuedCount(
  ctx: QueryCtx,
  name: string,
  key: string | undefined,
  ceiling: number,
): Promise<number> {
  const cursor = (await ctx.runQuery(components.batchWorker.lib.getCursor, {
    name: WORKER_NAME,
  })) as bigint | null;
  let total = 0;
  let scanned = 0;
  // Iterating reads lazily, so a limit whose queue blows past the ceiling costs
  // a couple of documents rather than the whole scan.
  for await (const update of ctx.db
    .query("pendingUpdates")
    .withIndex("name_key_updatedAt", (q) =>
      q
        .eq("name", name)
        .eq("key", key)
        .gt("updatedAt", cursor ?? 0n),
    )) {
    total += update.count;
    scanned++;
    if (total > ceiling || scanned >= MAX_PENDING_SCAN) break;
  }
  return total;
}

/** The most a single request could ever be granted from a limit. */
export function grantCeiling(config: {
  capacity: number;
  maxReserved?: number;
}): number {
  return config.capacity + (config.maxReserved ?? 0);
}

const { vQueryArgs, vQueryReturns, vMutationArgs, vMutationReturns } =
  defineBatchWorkerValidators({
    batch: {
      updates: v.array(
        v.object({
          id: v.id("pendingUpdates"),
          name: v.string(),
          key: v.optional(v.string()),
          count: v.number(),
          config: configValidator,
        }),
      ),
    },
  });

/**
 * Hand the next batch of queued updates to `applyBatch`, or go idle.
 *
 * This runs as a snapshot read that takes no read dependencies, so it can scan
 * the queue while consumers are inserting into it.
 */
export const getBatch = internalQuery({
  args: vQueryArgs,
  returns: vQueryReturns,
  handler: async (ctx, { cursor }) => {
    const updates = await ctx.db
      .query("pendingUpdates")
      .withIndex("updatedAt", (q) => q.gt("updatedAt", cursor ?? 0n))
      .take(BATCH_SIZE);
    if (updates.length === 0) {
      // Keep polling briefly before going idle. Consumers read the worker's
      // run status when they ping it, so a trickle of work thrashing between
      // idle and running is the one thing left that could conflict with them.
      return {
        kind: "idle" as const,
        cooldownMs: 10 * 1000,
        pollIntervalMs: 250,
      };
    }
    // The cursor is exclusive and everything one mutation inserted shares a
    // commit timestamp, so a batch must not stop in the middle of one — the
    // rows left behind would be skipped. Pull in the rest of the last tie so
    // the batch ends on a boundary.
    const lastCommitTs = updates[updates.length - 1]!.updatedAt as bigint;
    const taken = new Set(updates.map((update) => update._id));
    const tie = await ctx.db
      .query("pendingUpdates")
      .withIndex("updatedAt", (q) => q.eq("updatedAt", lastCommitTs))
      .collect();
    updates.push(...tie.filter((update) => !taken.has(update._id)));
    return {
      kind: "work" as const,
      batch: {
        updates: updates.map((update) => ({
          id: update._id,
          name: update.name,
          key: update.key,
          count: update.count,
          config: update.config,
        })),
      },
      cursor: lastCommitTs,
    };
  },
});

/** Fold a batch of queued updates into the limits they belong to. */
export const applyBatch = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { updates }) => {
    // Sum per limit first, so each limit is written once no matter how many
    // requests the batch covers.
    const byLimit = new Map<
      string,
      {
        name: string;
        key: string | undefined;
        count: number;
        config: RateLimitConfigValue;
        ids: Id<"pendingUpdates">[];
      }
    >();
    for (const update of updates) {
      // `resetRateLimit` and `clearAll` can drop rows out from under a batch
      // that's already been handed out. Skip those: applying them would charge
      // consumption to a limit that was just reset, and deleting them below
      // would throw and wedge the loop until the monitor restarts it.
      if ((await ctx.db.get("pendingUpdates", update.id)) === null) continue;
      const id = JSON.stringify([update.name, update.key ?? null]);
      const group = byLimit.get(id);
      if (group) {
        group.count += update.count;
        // Configs for one limit are expected to match; the newest wins.
        group.config = update.config;
        group.ids.push(update.id);
      } else {
        byLimit.set(id, {
          name: update.name,
          key: update.key,
          count: update.count,
          config: update.config,
          ids: [update.id],
        });
      }
    }
    const now = Date.now();
    for (const { name, key, count, config, ids } of byLimit.values()) {
      const existing = await getShard(ctx.db, name, key, SINGLETON_SHARD);
      const { value, ts } = calculateRateLimit(
        existing,
        configWithDefaults(config),
        now,
        count,
      );
      if (existing) {
        await ctx.db.patch("rateLimits", existing._id, { value, ts });
      } else {
        await ctx.db.insert("rateLimits", {
          name,
          key,
          shard: SINGLETON_SHARD,
          value,
          ts,
        });
      }
      // The worker owns cleanup: whatever we don't delete comes back next
      // batch. Deleting alongside the write keeps the two in step, so a
      // limit is never charged without its rows going away.
      for (const id of ids) {
        await ctx.db.delete("pendingUpdates", id);
      }
    }
    // Returning null re-runs immediately to drain the rest.
    return null;
  },
});

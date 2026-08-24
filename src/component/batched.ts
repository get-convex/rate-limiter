import { api } from "./_generated/api.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import {
  rateLimitArgs,
  rateLimitReturns,
  SINGLETON_SHARD,
  staleCheckReturns,
  type RateLimitArgs,
  type RateLimitReturns,
  type StaleCheckResult,
} from "../shared.js";
import {
  _checkRateLimitInternal,
  configWithDefaults,
  getShard,
  throwIfRateLimited,
  validateRequest,
} from "./internal.js";
import { grantCeiling, pingWorker, queuedCount } from "./worker.js";

/**
 * Check a lazy rate limit without consuming anything.
 *
 * The result is derived from the limit's stored value plus every update still
 * queued for the worker, so it accounts for consumption the worker hasn't
 * folded in yet. Call it with `useStaleSnapshot: true` from a mutation to read
 * it without taking a read dependency on either.
 */
export const check = query({
  args: rateLimitArgs,
  returns: staleCheckReturns,
  handler: async (ctx, args): Promise<StaleCheckResult> => {
    const status = await staleCheck(ctx, args);
    throwIfRateLimited(args, status);
    return status;
  },
});

/**
 * Consume from a lazy rate limit.
 *
 * Checks a recent snapshot and, if there's capacity, queues the consumption for
 * the worker to apply. Neither step takes a read dependency on the limit, so
 * any number of concurrent callers can consume the same limit without OCC
 * conflicts.
 */
export const limit = mutation({
  args: rateLimitArgs,
  returns: rateLimitReturns,
  handler: async (ctx, args): Promise<RateLimitReturns> => {
    // A stale snapshot read takes no read dependencies, so this mutation
    // doesn't conflict with the worker or with other consumers.
    const status: StaleCheckResult = await ctx.runQuery(
      api.batched.check,
      args,
      {
        useStaleSnapshot: true,
      },
    );
    if (!status.ok) return status;
    await ctx.db.insert("pendingUpdates", {
      name: args.name,
      key: args.key,
      count: args.count ?? 1,
      config: args.config,
      updatedAt: ctx.db.vars.commitTs,
    });
    await pingWorker(ctx);
    return status;
  },
});

async function staleCheck(
  ctx: QueryCtx,
  args: RateLimitArgs,
): Promise<StaleCheckResult> {
  validateRequest(args);
  const config = configWithDefaults(args.config);
  if (!config.lazy) {
    // Otherwise this would read shard 0 only, and disagree with what
    // `lib.rateLimit` sees for the same limit.
    throw new Error(
      `Rate limit ${args.name} isn't lazy. Add \`lazy: true\` to its config, ` +
        "or consume it with lib.rateLimit / lib.checkRateLimit.",
    );
  }
  const existing = await getShard(ctx.db, args.name, args.key, SINGLETON_SHARD);
  const queued = await queuedCount(
    ctx,
    args.name,
    args.key,
    grantCeiling(config),
  );
  const { status } = _checkRateLimitInternal(
    existing,
    config,
    (args.count ?? 1) + queued,
    args.reserve,
  );
  return status;
}

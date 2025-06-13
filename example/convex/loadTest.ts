import {
  RateLimiter,
  type RateLimitConfig,
  SECOND,
} from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { components } from "./_generated/api";

const rateLimiter = new RateLimiter(components.rateLimiter);

export const loadTestRateLimiter = internalAction({
  args: {
    qps: v.optional(v.number()),
    duration: v.optional(v.number()),
    rate: v.optional(v.number()),
    period: v.optional(v.number()),
    shards: v.optional(v.number()),
    capacity: v.optional(v.number()),
    overRequest: v.optional(v.number()),
    shardCapacity: v.optional(v.number()),
    qpsPerShard: v.optional(v.number()),
    qpsPerWorker: v.optional(v.number()),
    strategy: v.optional(
      v.union(v.literal("token bucket"), v.literal("fixed window"))
    ),
  },
  handler: async (ctx, args) => {
    const qps = args.qps ?? 100;
    const qpsPerShard = args.qpsPerShard ?? 2;
    const shards = args.shards ?? qps / qpsPerShard;
    const shardCapacity = args.shardCapacity ?? 10;
    const period = args.period ?? (shardCapacity / (qps / shards)) * SECOND;
    const duration = args.duration ?? Math.max(10_000, period * 5);
    const rate = args.rate ?? (period * qps) / SECOND;
    const capacity = args.capacity ?? rate;
    const overRequest = args.overRequest ?? 1.1;
    const qpsPerWorker = args.qpsPerWorker ?? 5;
    const numWorkers = Math.ceil(qps / qpsPerWorker);
    const workerPeriod = SECOND / ((qps * overRequest) / numWorkers);
    const config: RateLimitConfig = {
      kind: args.strategy ?? "token bucket",
      rate,
      period,
      shards,
      capacity,
    };

    await rateLimiter.reset(ctx, "llmRequests");
    const start = Date.now() + period;
    const end = start + duration;
    const successes = await Promise.all(
      Array.from({ length: numWorkers }, async () => {
        let successes = 0;
        let limited = 0;
        let occFailures = 0;
        const offset = Math.random() * period;
        let last = Date.now();
        async function delay() {
          const now = Date.now();
          const wait = (last + workerPeriod - now) * (0.5 + Math.random());
          last = now;
          if (wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }
        // Don't all start at once
        await new Promise((resolve) => setTimeout(resolve, offset));
        while (Date.now() < end) {
          try {
            const { ok, retryAfter } = await rateLimiter.limit(
              ctx,
              "llmRequests",
              { config }
            );
            const after = Date.now();
            if (ok) {
              if (after > start && after < end) successes++;
              await delay();
            } else {
              if (after > start && after < end) limited++;
              if (after + retryAfter >= end) break;
              const withJitter = retryAfter * (0.5 + Math.random());
              await new Promise((resolve) => setTimeout(resolve, withJitter));
            }
          } catch {
            const after = Date.now();
            if (after > start && after < end) occFailures++;
            await delay();
          }
        }
        return [successes, limited, occFailures];
      })
    );
    console.debug({ successes });
    const [succeeded, rateLimited, occFailures] = successes.reduce(
      (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
      [0, 0, 0]
    );
    const total = succeeded + rateLimited + occFailures;
    return {
      succeeded,
      occFailures,
      occFailureRate: (occFailures / total).toFixed(4),
      rateLimited,
      rateLimitedRate: (rateLimited / total).toFixed(4),
      numWorkers,
      capacityPerShard: capacity / shards,
      workerPeriod,
      config,
      qpms: {
        target: qps * overRequest,
        limit: qps,
        actual: succeeded / (duration / SECOND),
      },
    };
  },
});

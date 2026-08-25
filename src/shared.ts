import type { Infer } from "convex/values";
import { v } from "convex/values";

/** The shard that lazy rate limits read and write. */
export const SINGLETON_SHARD = 0;

const commonConfigFields = {
  rate: v.number(),
  period: v.number(),
  capacity: v.optional(v.number()),
  maxReserved: v.optional(v.number()),
  shards: v.optional(v.number()),
  lazy: v.optional(v.boolean()),
};

/**
 * A token bucket limits the rate of requests by continuously adding tokens to
 * be consumed when servicing requests.
 * The `rate` is the number of tokens added per `period`.
 * The `capacity` is the maximum number of tokens that can accumulate.
 * The `maxReserved` is the maximum number of tokens that can be reserved ahead
 * of time.
 */
export const tokenBucketValidator = v.object({
  kind: v.literal("token bucket"),
  ...commonConfigFields,
  start: v.optional(v.null()),
});

/**
 * A fixed window rate limit limits the rate of requests by adding a set number
 * of tokens (the `rate`) at the start of each fixed window of time (the
 * `period`) up to a maxiumum number of tokens (the `capacity`).
 * Requests consume tokens (1 by default).
 * The `start` determines what the windows are relative to in utc time.
 * If not provided, it will be a random number between 0 and `period`.
 */
export const fixedWindowValidator = v.object({
  kind: v.literal("fixed window"),
  ...commonConfigFields,
  start: v.optional(v.number()),
});

export const configValidator = v.union(
  tokenBucketValidator,
  fixedWindowValidator,
);

/**
 * The over-the-wire shape of a rate limit config: every field the validators
 * accept, including the `lazy` flag the clients set for themselves. Component
 * internals work with this; app code should use {@link RateLimitConfig} or
 * {@link LazyRateLimitConfig}.
 */
export type RateLimitConfigValue = Infer<typeof configValidator>;

type CommonConfigFields = {
  /** Tokens added per `period`. */
  rate: number;
  /** The duration, in ms, that `rate` tokens are added over. */
  period: number;
  /** The maximum number of tokens that can accumulate. Defaults to `rate`. */
  capacity?: number;
  /** The maximum number of tokens that can be reserved ahead of time. */
  maxReserved?: number;
};

type TokenBucketFields = {
  kind: "token bucket";
  start?: null;
} & CommonConfigFields;

type FixedWindowFields = {
  kind: "fixed window";
  /** What the windows are relative to, in utc time. Random if unset. */
  start?: number;
} & CommonConfigFields;

// Collapses an intersection into a single object type. Each config type has to
// stay a two-member union that discriminates on `kind`, or a config whose
// `kind` isn't narrowed to one literal stops being assignable to it.
type Flatten<T> = T extends object ? { [K in keyof T]: T[K] } : never;

/**
 * How many documents to spread the limit over, so more requests can consume it
 * at once. Each request reads a couple of shards, so the capacity a single
 * request can draw on is `capacity / (shards / 2)`.
 *
 * This is the only difference between {@link RateLimitConfig} and
 * {@link LazyRateLimitConfig}: keeping the two options on separate types is
 * what stops them being combined, since a lazy limit has one writer and extra
 * shards would only fragment its capacity.
 */
type ShardOption = { shards?: number };

/** A token bucket rate limit. See {@link tokenBucketValidator}. */
export type TokenBucketConfig = Flatten<TokenBucketFields & ShardOption>;

/** A fixed window rate limit. See {@link fixedWindowValidator}. */
export type FixedWindowConfig = Flatten<FixedWindowFields & ShardOption>;

/**
 * One of the supported rate limits, consumed synchronously.
 * See {@link tokenBucketValidator} and {@link fixedWindowValidator} for more
 * information.
 *
 * For limits hot enough that the synchronous write becomes a bottleneck, see
 * {@link LazyRateLimitConfig}.
 */
export type RateLimitConfig = TokenBucketConfig | FixedWindowConfig;

/** A lazily-consumed token bucket rate limit. */
export type LazyTokenBucketConfig = Flatten<TokenBucketFields>;

/** A lazily-consumed fixed window rate limit. */
export type LazyFixedWindowConfig = Flatten<FixedWindowFields>;

/**
 * A rate limit consumed asynchronously, for use with `LazyRateLimiter`.
 *
 * Requests check a recent snapshot and queue their consumption for a batch
 * worker to fold in, so any number of them can share one limit without write
 * conflicts, at the cost of a check that can lag slightly behind reality.
 *
 * There is deliberately no `shards` option: the worker is the limit's only
 * writer, so sharding it would only fragment its capacity.
 */
export type LazyRateLimitConfig = LazyTokenBucketConfig | LazyFixedWindowConfig;

/**
 * Arguments for rate limiting.
 * @param name The name of the rate limit.
 * @param key The key to use for the rate limit. If not provided, the rate limit
 * is a single shared value.
 * @param count The number of tokens to consume. Defaults to 1.
 * @param reserve Whether to reserve the tokens ahead of time. Defaults to false.
 * @param throws Whether to throw an error if the rate limit is exceeded.
 * By default, check/consume will just return { ok: false, retryAfter: number }.
 * @param config The rate limit configuration, if specified inline.
 * If you use {@link defineRateLimits} to define the named rate limit, you don't
 * specify the config inline.
 */
export const rateLimitArgs = {
  name: v.string(),
  key: v.optional(v.string()),
  count: v.optional(v.number()),
  reserve: v.optional(v.boolean()),
  throws: v.optional(v.boolean()),
  config: configValidator,
  // TODO: allow specifying the shard to use here
};

export type RateLimitArgs = {
  /** The name of the rate limit. */
  name: string;
  /** The key to use for the rate limit. If not provided, the rate limit
   * is a single shared value.  */
  key?: string;
  /**  The number of tokens to consume. Defaults to 1. */
  count?: number;
  /**  Whether to reserve the tokens ahead of time. Defaults to false. */
  reserve?: boolean;
  /**  Whether to throw an error if the rate limit is exceeded.
   * By default, check/consume will just return { ok: false, retryAfter: number }.
   */
  throws?: boolean;
  /** The rate limit configuration. See {@link RateLimitConfig}. */
  config: RateLimitConfigValue;
};

export const rateLimitReturns = v.union(
  v.object({
    ok: v.literal(true),
    retryAfter: v.optional(v.number()),
  }),
  v.object({
    ok: v.literal(false),
    // TODO: include the shard here they should retry with
    retryAfter: v.number(),
  }),
);

export type RateLimitReturns = Infer<typeof rateLimitReturns>;

/**
 * The result of checking a lazy rate limit. Structurally the same as
 * {@link RateLimitReturns}, but computed from a recent snapshot plus the
 * updates still queued for the background worker, so it can lag behind
 * consumption that hasn't committed yet.
 */
export const staleCheckReturns = rateLimitReturns;

export type StaleCheckResult = RateLimitReturns;

export type RateLimitError = {
  kind: "RateLimited";
  name: string;
  retryAfter: number;
};

export const getValueArgs = v.object({
  name: v.optional(v.string()),
  key: v.optional(v.string()),
  sampleShards: v.optional(v.number()),
  config: v.optional(configValidator),
});

export type GetValueArgs = Infer<typeof getValueArgs>;

export const getValueReturns = v.object({
  value: v.number(),
  ts: v.number(),
  shard: v.number(),
  config: configValidator,
});

export type GetValueReturns = Infer<typeof getValueReturns>;

/**
 * Calculate rate limit values based on the current state and configuration.
 * This function is exported so it can be used in both client and server code.
 */
export function calculateRateLimit(
  existing: { value: number; ts: number } | null,
  config: RateLimitConfigValue,
  now: number = Date.now(),
  count: number = 0,
) {
  const max = config.capacity ?? config.rate;
  const state = existing ?? {
    value: max,
    ts:
      config.kind === "fixed window"
        ? (config.start ?? now - Math.floor(Math.random() * config.period))
        : now,
  };

  let ts: number;
  let value: number;
  let retryAfter: number | undefined = undefined;
  let windowStart: number | undefined = undefined;

  if (config.kind === "token bucket") {
    const elapsed = now - state.ts;
    const rate = config.rate / config.period;
    value = Math.min(state.value + elapsed * rate, max) - count;
    ts = now;
    if (value < 0) {
      retryAfter = -value / rate;
    }
  } else {
    windowStart = state.ts;
    const elapsedWindows = Math.floor((now - state.ts) / config.period);
    const rate = config.rate;
    value = Math.min(state.value + rate * elapsedWindows, max) - count;
    ts = state.ts + elapsedWindows * config.period;
    if (value < 0) {
      const windowsNeeded = Math.ceil(-value / rate);
      retryAfter = ts + config.period * windowsNeeded - now;
    }
  }

  return { value, ts, retryAfter, windowStart };
}

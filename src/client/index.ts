import {
  type Expand,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  RateLimitArgs,
  RateLimitConfig,
  RateLimitError,
  RateLimitReturns,
  GetValueReturns,
} from "../shared.js";
import { getValueArgs, getValueReturns } from "../shared.js";
export { calculateRateLimit } from "../shared.js";
export type {
  RateLimitArgs,
  RateLimitConfig,
  RateLimitError,
  RateLimitReturns,
};

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/**
 * Read the current value of a rate limit against a stale snapshot, without
 * consuming. Backs {@link RateLimiter.check} when `stale` is set.
 */
async function staleCheck(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  component: ComponentApi,
  args: RateLimitArgs,
): Promise<RateLimitReturns> {
  const result = await ctx.runQuery(component.batched.check, {
    name: args.name,
    key: args.key,
    count: args.count,
    config: args.config,
  });
  if (!result.ok && args.throws) {
    throwRateLimitError(args.name, result.retryAfter);
  }
  return rateLimitStatus(result);
}

/**
 * Consume a rate limit without contending on it: admit against a stale
 * snapshot, then hand the consumption to a background worker to apply. Backs
 * {@link RateLimiter.limit} when `stale` is set. With `reserve`, the
 * consumption is enqueued even when the snapshot says the limit is exceeded.
 */
async function staleLimit(
  ctx: MutationCtx | ActionCtx,
  component: ComponentApi,
  args: RateLimitArgs,
): Promise<RateLimitReturns> {
  const checkArgs = {
    name: args.name,
    key: args.key,
    count: args.count,
    config: args.config,
  };
  // In a mutation, read against a stale snapshot so the check adds no read
  // dependency and never OCC-conflicts with the worker applying enqueued
  // consumption. In an action there's no read set, so a plain query (its own
  // transaction) is already contention-free.
  const result: StaleCheckResult =
    "runAction" in ctx
      ? await ctx.runQuery(component.batched.check, checkArgs)
      : await ctx.runQuery(component.batched.check, checkArgs, {
          useStaleSnapshot: true,
        });
  if (result.ok || args.reserve) {
    await ctx.runMutation(component.batched.push, {
      name: args.name,
      key: args.key,
      updates: result.updates,
      config: args.config,
    });
  }
  if (!result.ok && args.throws) {
    throwRateLimitError(args.name, result.retryAfter);
  }
  return rateLimitStatus(result);
}

export function isRateLimitError(
  error: unknown,
): error is { data: RateLimitError } {
  return (
    error instanceof ConvexError &&
    (error as any).data["kind"] === "RateLimited"
  );
}

/**
 * Define rate limits for a set of named rate limits.
 * e.g.
 * ```ts
 * import { RateLimiter } from "@convex-dev/rate-limiter";
 * import { components } from "./_generated/api.js";
 *
 * const rateLimiter = new RateLimiter(components.rateLimiter, {
 *   // A per-user limit, allowing one every ~6 seconds.
 *   // Allows up to 3 in quick succession if they haven't sent many recently.
 *   sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
 *   // One global / singleton rate limit
 *   freeTrialSignUp: { kind: "fixed window", rate: 100, period: HOUR },
 * });
 * //... elsewhere
 * await rateLimiter.limit(ctx, "sendMessage", { key: ctx.userId, throws: true });
 * ```
 *
 * @param component The rate limiter component. Like `components.rateLimiter`.
 *   Imported like `import { components } from "./_generated/api.js";`
 * @param limits The rate limits to define. The key is the name of the rate limit.
 * See {@link RateLimitConfig} for more information.
 * @returns A rate limiter that has types based on the provided limits.
 * If you provide a different name, you will need to provide the config inline.
 */
export class RateLimiter<
  Limits extends Record<string, RateLimitConfig> = Record<never, never>,
> {
  constructor(
    public component: ComponentApi,
    public limits?: Limits,
  ) {}

  /**
   * Check a rate limit.
   * This function will check the rate limit and return whether the request is
   * allowed, and if not, when it could be retried.
   * Unlike {@link limit}, this function does not consume any tokens.
   *
   * @param ctx The ctx object from a query or mutation, including runQuery.
   * @param name The name of the rate limit.
   * @param options The rate limit arguments. `config` is required if the rate
   * limit was not defined in {@link RateLimiter}. See {@link RateLimitArgs}.
   * @returns `{ ok, retryAfter }`: `ok` is true if the rate limit is not exceeded.
   * `retryAfter` is the duration in milliseconds when retrying could succeed.
   * If `reserve` is true, `ok` is true if there's enough capacity including
   * reservation. If there is a maxiumum reservation limit, `ok` will be false
   * when it is exceeded. When `ok` is true and `retryAfter` is defined, it is
   * the duration you must wait before executing the work.
   * e.g.:
   * ```ts
   * if (status.retryAfter) {
   *   await ctx.scheduler.runAfter(retryAfter, ...)
   * ```
   *
   * Pass `stale: true` to read the value against a stale snapshot (no read
   * dependency, so no OCC contention) — the eventually-consistent counterpart
   * to {@link limit} with `stale`.
   */
  async check<Name extends string = keyof Limits & string>(
    ctx: QueryCtx | MutationCtx | ActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [WithKnownNameOrInlinedConfig<Limits, Name, ClientRateLimitArgs>?]
      : [WithKnownNameOrInlinedConfig<Limits, Name, ClientRateLimitArgs>]
  ): Promise<RateLimitReturns> {
    const args = options[0];
    const { stale, ...rest } = args ?? {};
    const config = this.getConfig(args, name);
    if (stale) {
      return staleCheck(ctx, this.component, { ...rest, name, config });
    }
    return ctx.runQuery(this.component.lib.checkRateLimit, {
      ...rest,
      name,
      config,
    });
  }

  /**
   * Rate limit a request.
   * This function will check the rate limit and return whether the request is
   * allowed, and if not, when it could be retried.
   *
   * @param ctx The ctx object from a mutation, including runMutation.
   * @param name The name of the rate limit.
   * @param options The rate limit arguments. `config` is required if the rate
   * limit was not defined in {@link RateLimiter}. See {@link RateLimitArgs}.
   * @returns `{ ok, retryAfter }`: `ok` is true if the rate limit is not exceeded.
   * `retryAfter` is the duration in milliseconds when retrying could succeed.
   * If `reserve` is true, `ok` is true if there's enough capacity including
   * reservation. If there is a maxiumum reservation limit, `ok` will be false
   * when it is exceeded. When `ok` is true and `retryAfter` is defined, it is
   * the duration you must wait before executing the work.
   * e.g.:
   * ```ts
   * if (status.retryAfter) {
   *   await ctx.scheduler.runAfter(retryAfter, ...)
   * ```
   *
   * Pass `stale: true` to use the eventually-consistent path: the limit is
   * checked against a stale snapshot (with no read dependency, so it never
   * causes OCC contention) and, if there's capacity, the consumption is
   * enqueued for a background worker to apply. This trades strict consistency
   * for throughput — a burst can briefly overshoot the limit before the queue
   * drains. With `stale`, `reserve: true` enqueues the consumption even when
   * the snapshot says the limit is already exceeded.
   */
  async limit<Name extends string = keyof Limits & string>(
    ctx: MutationCtx | ActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [WithKnownNameOrInlinedConfig<Limits, Name, ClientRateLimitArgs>?]
      : [WithKnownNameOrInlinedConfig<Limits, Name, ClientRateLimitArgs>]
  ): Promise<RateLimitReturns> {
    const args = options[0];
    const { stale, ...rest } = args ?? {};
    const config = this.getConfig(args, name);
    if (stale) {
      return staleLimit(ctx, this.component, { ...rest, name, config });
    }
    return ctx.runMutation(this.component.lib.rateLimit, {
      ...rest,
      name,
      config,
    });
  }

  /**
   * Reset a rate limit. This will remove the rate limit from the database.
   * The next request will start fresh.
   * Note: In the case of a fixed window without a specified `start`,
   * the new window will be a random time.
   * @param ctx The ctx object from a mutation, including runMutation.
   * @param name The name of the rate limit to reset, including all shards.
   * @param key If a key is provided, it will reset the rate limit for that key.
   * If not, it will reset the rate limit for the shared value.
   */
  async reset<Name extends string = keyof Limits & string>(
    { runMutation }: MutationCtx | ActionCtx,
    name: Name,
    args?: { key?: string },
  ): Promise<void> {
    await runMutation(this.component.lib.resetRateLimit, {
      ...(args ?? null),
      name,
    });
  }

  /**
   * Get the current value and metadata of a rate limit.
   * This function returns the current token utilization data without consuming any tokens.
   *
   * @param ctx The ctx object from a query, including runQuery.
   * @param name The name of the rate limit.
   * @param options The rate limit arguments. `config` is required if the rate
   * limit was not defined in {@link RateLimiter}. See {@link RateLimitArgs}.
   * @returns An object containing the current value, timestamp, window start time (for fixed window),
   * and the rate limit configuration.
   */
  async getValue<Name extends string = keyof Limits & string>(
    ctx: QueryCtx | MutationCtx | ActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            {
              key?: string;
              sampleShards?: number;
            }
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            {
              key?: string;
              sampleShards?: number;
            }
          >,
        ]
  ): Promise<GetValueReturns> {
    return ctx.runQuery(this.component.lib.getValue, {
      ...options[0],
      name,
      config: this.getConfig(options[0], name),
    });
  }

  /**
   * Creates a public query that can be exported from your API that returns the
   * current value of a rate limit.
   * This is a convenience function to re-export the query for client use.
   *
   * @param name The name of the rate limit.
   * @returns An object containing a getRateLimit function that can be exported.
   *
   * Example:
   * ```ts
   * // In your API file:
   * export const getRateLimit = rateLimiter.getValueQuery("myLimit");
   *
   * // In your client:
   * const { status, getValue, retryAt } = useRateLimit(api.getRateLimit, 10);
   * ```
   */
  hookAPI<
    DataModel extends GenericDataModel,
    Name extends string = keyof Limits & string,
  >(
    name: Name,
    ...options: Name extends keyof Limits
      ? [WithKnownNameOrInlinedConfig<Limits, Name, HookOpts<DataModel>>?]
      : [WithKnownNameOrInlinedConfig<Limits, Name, HookOpts<DataModel>>]
  ) {
    return {
      getRateLimit: queryGeneric({
        args: getValueArgs,
        returns: getValueReturns,
        handler: async (ctx, args): Promise<GetValueReturns> => {
          const finalName = args.name ?? name;
          const { key: keyOrFn, ...rest } = options[0] ?? {};
          let key: string | undefined;
          if (args.key && !keyOrFn) {
            throw new Error(
              "To allow client-provided key, provide a `key` function in the hook options.",
            );
          }
          if (typeof keyOrFn === "function") {
            key = await keyOrFn(ctx, args.key);
          } else if (keyOrFn !== undefined) {
            key = keyOrFn;
          }
          return ctx.runQuery(this.component.lib.getValue, {
            ...rest,
            ...args,
            key,
            name: finalName,
            config: args.config ?? this.getConfig(options[0], finalName),
          });
        },
      }),
      getServerTime: mutationGeneric({
        args: {},
        returns: v.number(),
        handler: async () => {
          return Date.now();
        },
      }),
    };
  }

  private getConfig<Name extends string, Args>(
    args: WithKnownNameOrInlinedConfig<Limits, Name, Args> | undefined,
    name: Name,
  ): RateLimitConfig {
    const config =
      (args && "config" in args && args.config) ||
      (this.limits && this.limits[name]);
    if (!config) {
      throw new Error(
        `Rate limit ${name} not defined. ` +
          `You must provide a config inline or define it in the constructor.`,
      );
    }
    return config;
  }
}

export default RateLimiter;

// Type utilities

export type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
export type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;
type WithKnownNameOrInlinedConfig<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
  Args,
> = Expand<
  Args extends unknown
    ? Omit<Args, "name" | "config"> &
        (Name extends keyof Limits
          ? object
          : {
              /**  The rate limit configuration, if specified inline.
               * If you use {@link RateLimits} to define the named rate limit, you don't
               * specify the config inline.}
               */
              config: RateLimitConfig;
            })
    : never
>;

/**
 * Arguments accepted by {@link RateLimiter.limit} and {@link RateLimiter.check}.
 * Same as {@link RateLimitArgs}, plus the `stale` flag that opts into the
 * eventually-consistent (batched) path.
 */
export type ClientRateLimitArgs = RateLimitArgs & {
  /**
   * Use the eventually-consistent path: check the limit against a stale
   * snapshot (no read dependency, so no OCC contention) and enqueue the
   * consumption for a background worker to apply. Trades strict consistency
   * for throughput. With `reserve`, consumption is enqueued even when the
   * snapshot says the limit is exceeded.
   */
  stale?: boolean;
};

type ShardConsumption = {
  shard: number;
  count: number;
};

// The shard writes that `component.batched.check` proposes for this request,
// alongside the pass/fail status. The client enqueues these when it decides to
// consume (always when `ok`; also when `reserve` even if the limit is exceeded).
type StaleCheckResult = RateLimitReturns & {
  updates: ShardConsumption[];
};

function rateLimitStatus(result: StaleCheckResult): RateLimitReturns {
  return result.ok
    ? { ok: true, retryAfter: result.retryAfter }
    : { ok: false, retryAfter: result.retryAfter };
}

function throwRateLimitError(name: string, retryAfter: number): never {
  throw new ConvexError({
    kind: "RateLimited",
    name,
    retryAfter,
  } satisfies RateLimitError);
}

type HookOpts<DataModel extends GenericDataModel> = {
  key?:
    | string
    | ((
        ctx: GenericQueryCtx<DataModel>,
        // The key provided by the client, if any.
        keyFromClient?: string,
      ) => string | Promise<string>);
  sampleShards?: number;
};

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
  RateLimitConfigValue,
  LazyRateLimitConfig,
  GetValueReturns,
  StaleCheckResult,
} from "../shared.js";
import { getValueArgs, getValueReturns } from "../shared.js";
export { calculateRateLimit } from "../shared.js";
export type {
  RateLimitArgs,
  RateLimitConfig,
  RateLimitConfigValue,
  RateLimitError,
  RateLimitReturns,
  LazyRateLimitConfig,
  StaleCheckResult,
};
export type {
  FixedWindowConfig,
  TokenBucketConfig,
  LazyFixedWindowConfig,
  LazyTokenBucketConfig,
} from "../shared.js";

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

export function isRateLimitError(
  error: unknown,
): error is { data: RateLimitError } {
  return (
    error instanceof ConvexError &&
    (error as any).data["kind"] === "RateLimited"
  );
}

/**
 * Shared plumbing for {@link RateLimiter} and {@link LazyRateLimiter}: config
 * resolution, and the operations that don't depend on how a limit is consumed.
 *
 * @typeParam Limits - the named limits this client knows about.
 * @typeParam InlineConfig - the config shape callers may pass inline, which is
 * what keeps `shards` off lazy limits and `lazy` off synchronous ones.
 */
abstract class RateLimiterBase<
  Limits extends Record<string, RateLimitConfigValue>,
  InlineConfig,
> {
  public limits?: Limits;

  constructor(
    public component: ComponentApi,
    limits?: Limits,
  ) {
    this.limits = limits;
  }

  /**
   * Put a config on the wire. The component takes one shape for both clients;
   * this is where each says which one it is.
   */
  protected abstract toWireConfig(
    config: RateLimitConfigValue,
  ): RateLimitConfigValue;

  /**
   * Reset a rate limit. This will remove the rate limit from the database.
   * The next request will start fresh.
   * Note: In the case of a fixed window without a specified `start`,
   * the new window will be a random time.
   * @param ctx The ctx object from a mutation, including runMutation.
   * @param name The name of the rate limit to reset, including all shards and
   * any consumption still queued.
   * @param args If a key is provided, it will reset the rate limit for that key.
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
   * limit was not defined on the client. See {@link RateLimitArgs}.
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
            { key?: string; sampleShards?: number },
            InlineConfig
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            { key?: string; sampleShards?: number },
            InlineConfig
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
      ? [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            HookOpts<DataModel>,
            InlineConfig
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            HookOpts<DataModel>,
            InlineConfig
          >,
        ]
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
            // A config that came from the caller doesn't know which client it
            // reached, so stamp it either way.
            config: args.config
              ? this.toWireConfig(args.config)
              : this.getConfig(options[0], finalName),
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

  protected getConfig<Name extends string, Args>(
    args:
      | WithKnownNameOrInlinedConfig<Limits, Name, Args, InlineConfig>
      | undefined,
    name: Name,
  ): RateLimitConfigValue {
    const config =
      (args && "config" in args && (args.config as RateLimitConfigValue)) ||
      (this.limits && this.limits[name]);
    if (!config) {
      throw new Error(
        `Rate limit ${name} not defined. ` +
          `You must provide a config inline or define it in the constructor.`,
      );
    }
    return this.toWireConfig(config);
  }
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
 * Every request updates the limit as it happens, so the limit is never
 * exceeded. For limits hot enough that those writes contend, see
 * {@link LazyRateLimiter}.
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
> extends RateLimiterBase<Limits, RateLimitConfig> {
  constructor(component: ComponentApi, limits?: Limits & Synchronous<Limits>) {
    super(component, limits);
  }

  protected toWireConfig(config: RateLimitConfigValue): RateLimitConfigValue {
    return config;
  }

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
   */
  async check<Name extends string = keyof Limits & string>(
    ctx: QueryCtx | MutationCtx | ActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            RateLimitConfig
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            RateLimitConfig
          >,
        ]
  ): Promise<RateLimitReturns> {
    return ctx.runQuery(this.component.lib.checkRateLimit, {
      ...options[0],
      name,
      config: this.getConfig(options[0], name),
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
   */
  async limit<Name extends string = keyof Limits & string>(
    ctx: MutationCtx | ActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            RateLimitConfig
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            RateLimitConfig
          >,
        ]
  ): Promise<RateLimitReturns> {
    return ctx.runMutation(this.component.lib.rateLimit, {
      ...options[0],
      name,
      config: this.getConfig(options[0], name),
    });
  }
}

/**
 * Define rate limits that are consumed asynchronously.
 * e.g.
 * ```ts
 * import { LazyRateLimiter } from "@convex-dev/rate-limiter";
 * import { components } from "./_generated/api.js";
 *
 * const lazyRateLimiter = new LazyRateLimiter(components.rateLimiter, {
 *   llmTokens: { kind: "token bucket", rate: 40000, period: MINUTE },
 * });
 * //... elsewhere
 * await lazyRateLimiter.limit(ctx, "llmTokens", { count: tokens });
 * ```
 *
 * {@link limit} reads the limit from a recent snapshot and queues the
 * consumption for a batch worker to apply, neither of which takes a read
 * dependency on the limit. Any number of requests can therefore share one limit
 * without conflicting, which is what {@link RateLimiter} — even sharded — can't
 * do. Reads subtract whatever is still queued, so a burst is bounded rather
 * than waved through.
 *
 * The trade is that a lazy limit is eventually consistent and can admit
 * slightly more than its rate for a moment. If a limit must never be exceeded,
 * use {@link RateLimiter} with `shards`.
 *
 * @param component The rate limiter component. Like `components.rateLimiter`.
 *   Imported like `import { components } from "./_generated/api.js";`
 * @param limits The rate limits to define. The key is the name of the rate
 * limit. See {@link LazyRateLimitConfig} for more information. Note that limit
 * names are shared across clients, so don't reuse a name defined on a
 * {@link RateLimiter}.
 * @returns A rate limiter that has types based on the provided limits.
 * If you provide a different name, you will need to provide the config inline.
 */
export class LazyRateLimiter<
  Limits extends Record<string, LazyRateLimitConfig> = Record<never, never>,
> extends RateLimiterBase<Limits, LazyRateLimitConfig> {
  constructor(component: ComponentApi, limits?: Limits & Unsharded<Limits>) {
    super(component, limits);
  }

  protected toWireConfig(config: RateLimitConfigValue): RateLimitConfigValue {
    return { ...config, lazy: true };
  }

  /**
   * Check a lazy rate limit without consuming anything.
   *
   * The answer accounts for consumption the worker hasn't applied yet, so it
   * won't wave through a burst that has already used up the limit. Called from
   * a mutation, it reads a recent snapshot, so checking a limit never makes the
   * transaction conflict with everyone else consuming it.
   *
   * @param ctx The ctx object from a query, mutation, or action.
   * @param name The name of the rate limit.
   * @param options The rate limit arguments. `config` is required if the rate
   * limit was not defined in {@link LazyRateLimiter}. See {@link RateLimitArgs}.
   * @returns `{ ok, retryAfter }`, as {@link RateLimiter.check}, except derived
   * from a snapshot plus the queue rather than from the committed value.
   */
  async check<Name extends string = keyof Limits & string>(
    ctx: LazyQueryCtx | LazyMutationCtx | LazyActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            LazyRateLimitConfig
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            LazyRateLimitConfig
          >,
        ]
  ): Promise<StaleCheckResult> {
    const args = {
      ...options[0],
      name,
      config: this.getConfig(options[0], name),
    };
    // Only a mutation can read a stale snapshot — a query ctx throws on the
    // option — so ask which one we're in rather than guessing from the shape.
    const { type } = await ctx.meta.getFunctionMetadata();
    return type === "mutation"
      ? (ctx as LazyMutationCtx).runQuery(this.component.batched.check, args, {
          useStaleSnapshot: true,
        })
      : ctx.runQuery(this.component.batched.check, args);
  }

  /**
   * Consume from a lazy rate limit.
   *
   * Checks a recent snapshot and, if there's capacity, queues the consumption
   * for the batch worker. Neither step takes a read dependency on the limit, so
   * concurrent callers don't conflict.
   *
   * @param ctx The ctx object from a mutation or action.
   * @param name The name of the rate limit.
   * @param options The rate limit arguments. `config` is required if the rate
   * limit was not defined in {@link LazyRateLimiter}. See {@link RateLimitArgs}.
   * @returns `{ ok, retryAfter }`, as {@link RateLimiter.limit}. When `ok`, the
   * consumption is queued, not yet applied.
   */
  async limit<Name extends string = keyof Limits & string>(
    ctx: MutationCtx | ActionCtx,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            LazyRateLimitConfig
          >?,
        ]
      : [
          WithKnownNameOrInlinedConfig<
            Limits,
            Name,
            RateLimitArgs,
            LazyRateLimitConfig
          >,
        ]
  ): Promise<RateLimitReturns> {
    return ctx.runMutation(this.component.batched.limit, {
      ...options[0],
      name,
      config: this.getConfig(options[0], name),
    });
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

// `LazyRateLimiter.check` needs `meta` to tell whether it may read a stale
// snapshot. Only that method needs it, so it stays off the ctx types above.
export type LazyQueryCtx = Pick<
  GenericQueryCtx<GenericDataModel>,
  "runQuery" | "meta"
>;
export type LazyMutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "meta"
>;
export type LazyActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction" | "meta"
>;

/**
 * Rejects a `shards` option on a lazy limit. The worker is the limit's only
 * writer, so extra shards would just fragment its capacity.
 *
 * `LazyRateLimitConfig` has no `shards` field, which is enough on its own when
 * a config is annotated with it. This covers limits written inline on the
 * constructor, where `Limits` is inferred from the argument and so excess
 * properties aren't flagged.
 */
type Unsharded<Limits> = {
  [Name in keyof Limits]: Limits[Name] extends { shards: number }
    ? "A lazy rate limit can't be sharded: the batch worker is its only writer"
    : Limits[Name];
};

/** Rejects a `lazy` option here, and points at the client that takes one. */
type Synchronous<Limits> = {
  [Name in keyof Limits]: Limits[Name] extends { lazy: boolean }
    ? "Define lazy rate limits on a LazyRateLimiter instead"
    : Limits[Name];
};

type WithKnownNameOrInlinedConfig<
  Limits extends Record<string, RateLimitConfigValue>,
  Name extends string,
  Args,
  Config,
> = Expand<
  Omit<Args, "name" | "config"> &
    (Name extends keyof Limits
      ? object
      : {
          /**  The rate limit configuration, if specified inline.
           * If you define the named rate limit on the client, you don't
           * specify the config inline.}
           */
          config: Config;
        })
>;

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

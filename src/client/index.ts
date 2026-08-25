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
  StaleCheckResult,
};
export type { FixedWindowConfig, TokenBucketConfig } from "../shared.js";

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
 * By default every call updates the limit as it happens, so the limit is never
 * exceeded. For limits hot enough that those writes contend, pass
 * `async: true` to {@link limit} and `stale: true` to {@link check} — see
 * {@link limit} for what that trades away.
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
   * Pass `stale: true` for limits you consume with `async: true`. That reads the
   * limit from a recent snapshot and adds in the consumption the batch worker
   * hasn't applied yet, so the answer accounts for the queue; from a mutation it
   * also takes no read dependency on the limit, so checking it can't make the
   * transaction conflict with everyone else consuming it. Without it, a check on
   * an asynchronously-consumed limit ignores the queue and will wave through a
   * burst that has already used the limit up.
   *
   * @param ctx The ctx object from a query, mutation, or action.
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
    ctx: (QueryCtx | MutationCtx | ActionCtx) & CtxMeta,
    name: Name,
    ...options: Name extends keyof Limits & string
      ? [CheckOptions<Limits, Name>?]
      : [CheckOptions<Limits, Name>]
  ): Promise<RateLimitReturns> {
    const { stale, ...rest } = (options[0] ?? {}) as { stale?: boolean };
    const args = {
      ...rest,
      name,
      config: this.getConfig(options[0], name, stale),
    };
    if (!stale) {
      return ctx.runQuery(this.component.lib.checkRateLimit, args);
    }
    // Only a mutation may read a stale snapshot — a query ctx throws on the
    // option — so ask which one we're in rather than guessing from the shape.
    const { type } = await ctx.meta.getFunctionMetadata();
    const result: StaleCheckResult =
      type === "mutation"
        ? await (ctx as MutationCtx).runQuery(
            this.component.batched.check,
            args,
            { useStaleSnapshot: true },
          )
        : await ctx.runQuery(this.component.batched.check, args);
    return result;
  }

  /**
   * Rate limit a request.
   * This function will check the rate limit and return whether the request is
   * allowed, and if not, when it could be retried.
   *
   * Pass `async: true` and the consumption is queued for a batch worker instead
   * of written on the spot. The call reads the limit from a recent snapshot and
   * appends to a queue, neither of which takes a read dependency on the limit,
   * so any number of concurrent callers can consume it without conflicting —
   * which sharding alone can't achieve. The worker folds the queue in, summing
   * everything for one limit into a single write, and runs one loop at a time,
   * so the limit has exactly one writer.
   *
   * Two things to know before using it:
   *
   * - **It's all or nothing per limit.** A synchronous call doesn't see queued
   *   consumption and writes the same document the worker does, so mixing the
   *   two on one limit both over-admits and reintroduces the conflicts. Use
   *   `async: true` on every call for a limit, and `stale: true` on every
   *   {@link check} and {@link getValue} of it. Nothing enforces this.
   * - **It's eventually consistent.** The limit can admit slightly more than
   *   its rate for a moment. If it must never be exceeded, leave this off and
   *   use `shards` instead.
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
      ? [LimitOptions<Limits, Name>?]
      : [LimitOptions<Limits, Name>]
  ): Promise<RateLimitReturns> {
    const { async: isAsync, ...rest } = (options[0] ?? {}) as {
      async?: boolean;
    };
    const args = {
      ...rest,
      name,
      config: this.getConfig(options[0], name, isAsync),
    };
    return ctx.runMutation(
      isAsync ? this.component.batched.limit : this.component.lib.rateLimit,
      args,
    );
  }

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
   * Pass `stale: true` for limits you consume with `async: true`, so the value
   * accounts for consumption the batch worker hasn't applied yet. Note that this
   * makes a subscribed query recompute as consumption is enqueued, not only as
   * it's applied.
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
      ? [GetValueOptions<Limits, Name>?]
      : [GetValueOptions<Limits, Name>]
  ): Promise<GetValueReturns> {
    const { stale, ...rest } = (options[0] ?? {}) as { stale?: boolean };
    return ctx.runQuery(this.component.lib.getValue, {
      ...rest,
      name,
      config: this.getConfig(options[0], name, stale),
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
      ? [HookOptions<Limits, Name, DataModel>?]
      : [HookOptions<Limits, Name, DataModel>]
  ) {
    return {
      getRateLimit: queryGeneric({
        args: getValueArgs,
        returns: getValueReturns,
        handler: async (ctx, args): Promise<GetValueReturns> => {
          const finalName = args.name ?? name;
          const {
            key: keyOrFn,
            stale,
            ...rest
          } = (options[0] ?? {}) as HookOpts<DataModel> & { stale?: boolean };
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
            // A config that came in over the wire doesn't carry the flag, so
            // apply the hook's own setting either way.
            config: withAsync(
              args.config ?? this.getConfig(options[0], finalName),
              stale,
            ),
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
    args: (Args & { config?: RateLimitConfig }) | undefined,
    name: Name,
    isAsync?: boolean,
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
    return withAsync(config, isAsync);
  }
}

/**
 * Tell the component which mode this call is in. It takes one config shape for
 * both, and `lazy` is how a call says it wants the asynchronous one.
 */
function withAsync(
  config: RateLimitConfigValue,
  isAsync?: boolean,
): RateLimitConfigValue {
  return isAsync ? { ...config, lazy: true } : config;
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

/**
 * `check` needs `meta` to tell whether `stale` can be honored, so it asks for it
 * on top of whichever ctx you have. Every real ctx provides it.
 */
export type CtxMeta = Pick<GenericQueryCtx<GenericDataModel>, "meta">;

/**
 * Asynchronous consumption applies to the singleton shard, so it can't be
 * combined with a limit spread over several. Only checkable for limits defined
 * on the client; with an inline config the component throws instead.
 */
type AsyncOption<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
  Key extends string,
> = Name extends keyof Limits
  ? Limits[Name] extends { shards: number }
    ? Partial<Record<Key, never>>
    : Partial<Record<Key, boolean>>
  : Partial<Record<Key, boolean>>;

type CheckOptions<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
> = Expand<
  WithKnownNameOrInlinedConfig<Limits, Name, RateLimitArgs> &
    AsyncOption<Limits, Name, "stale">
>;

type LimitOptions<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
> = Expand<
  WithKnownNameOrInlinedConfig<Limits, Name, RateLimitArgs> &
    AsyncOption<Limits, Name, "async">
>;

type GetValueOptions<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
> = Expand<
  WithKnownNameOrInlinedConfig<
    Limits,
    Name,
    { key?: string; sampleShards?: number }
  > &
    AsyncOption<Limits, Name, "stale">
>;

type HookOptions<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
  DataModel extends GenericDataModel,
> = Expand<
  WithKnownNameOrInlinedConfig<Limits, Name, HookOpts<DataModel>> &
    AsyncOption<Limits, Name, "stale">
>;

type WithKnownNameOrInlinedConfig<
  Limits extends Record<string, RateLimitConfig>,
  Name extends string,
  Args,
> = Omit<Args, "name" | "config"> &
  (Name extends keyof Limits
    ? object
    : {
        /**  The rate limit configuration, if specified inline.
         * If you use {@link RateLimiter} to define the named rate limit, you
         * don't specify the config inline.}
         */
        config: RateLimitConfig;
      });

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

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: {
  example: {
    getRateLimit: FunctionReference<
      "query",
      "public",
      {
        config?:
          | {
              capacity?: number;
              kind: "token bucket";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: null;
            }
          | {
              capacity?: number;
              kind: "fixed window";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: number;
            };
        key?: string;
        name?: string;
        sampleShards?: number;
      },
      {
        config:
          | {
              capacity?: number;
              kind: "token bucket";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: null;
            }
          | {
              capacity?: number;
              kind: "fixed window";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: number;
            };
        shard: number;
        ts: number;
        value: number;
      }
    >;
    getServerTime: FunctionReference<"mutation", "public", {}, number>;
    consumeTokens: FunctionReference<
      "mutation",
      "public",
      { count?: number },
      any
    >;
  };
  playground: {
    getRateLimit: FunctionReference<
      "query",
      "public",
      {
        config?:
          | {
              capacity?: number;
              kind: "token bucket";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: null;
            }
          | {
              capacity?: number;
              kind: "fixed window";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: number;
            };
        key?: string;
        name?: string;
        sampleShards?: number;
      },
      {
        config:
          | {
              capacity?: number;
              kind: "token bucket";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: null;
            }
          | {
              capacity?: number;
              kind: "fixed window";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: number;
            };
        shard: number;
        ts: number;
        value: number;
      }
    >;
    getServerTime: FunctionReference<"mutation", "public", {}, number>;
    consumeRateLimit: FunctionReference<
      "mutation",
      "public",
      {
        config:
          | {
              capacity?: number;
              kind: "token bucket";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: null;
            }
          | {
              capacity?: number;
              kind: "fixed window";
              maxReserved?: number;
              period: number;
              rate: number;
              shards?: number;
              start?: number;
            };
        count: number;
        reserve: boolean;
      },
      any
    >;
    resetRateLimit: FunctionReference<"mutation", "public", {}, any>;
  };
};

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: {
  example: {
    test: FunctionReference<"mutation", "internal", {}, any>;
    check: FunctionReference<"query", "internal", { key?: string }, any>;
    throws: FunctionReference<"mutation", "internal", {}, any>;
    inlineConfig: FunctionReference<"mutation", "internal", {}, any>;
    inlineVanilla: FunctionReference<"mutation", "internal", {}, any>;
  };
  loadTest: {
    loadTestRateLimiter: FunctionReference<
      "action",
      "internal",
      {
        capacity?: number;
        duration?: number;
        overRequest?: number;
        period?: number;
        qps?: number;
        qpsPerShard?: number;
        qpsPerWorker?: number;
        rate?: number;
        shardCapacity?: number;
        shards?: number;
        strategy?: "token bucket" | "fixed window";
      },
      any
    >;
  };
};

export declare const components: {
  rateLimiter: {
    lib: {
      checkRateLimit: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
      getValue: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          key?: string;
          name: string;
          sampleShards?: number;
        },
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          shard: number;
          ts: number;
          value: number;
        }
      >;
      rateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key?: string; name: string },
        null
      >;
    };
    time: {
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
    };
  };
};

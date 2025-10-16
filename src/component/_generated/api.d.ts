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
  lib: {
    getServerTime: FunctionReference<"mutation", "public", {}, number>;
    rateLimit: FunctionReference<
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
        count?: number;
        key?: string;
        name: string;
        reserve?: boolean;
        throws?: boolean;
      },
      { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
    >;
    checkRateLimit: FunctionReference<
      "query",
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
        count?: number;
        key?: string;
        name: string;
        reserve?: boolean;
        throws?: boolean;
      },
      { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
    >;
    getValue: FunctionReference<
      "query",
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
    resetRateLimit: FunctionReference<
      "mutation",
      "public",
      { key?: string; name: string },
      null
    >;
    clearAll: FunctionReference<
      "mutation",
      "public",
      { before?: number },
      null
    >;
  };
  time: {
    getServerTime: FunctionReference<"mutation", "public", {}, number>;
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
export declare const internal: {};

export declare const components: {};

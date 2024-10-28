/* prettier-ignore-start */

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as internal_ from "../internal.js";
import type * as lib from "../lib.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  internal: typeof internal_;
  lib: typeof lib;
}>;
export type Mounts = {
  lib: {
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
      "public",
      { before?: number },
      null
    >;
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
      "public",
      { key?: string; name: string },
      null
    >;
  };
};
// For now fullApiWithMounts is only fullApi which provides
// jump-to-definition in component client code.
// Use Mounts for the same type without the inference.
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};

/* prettier-ignore-end */

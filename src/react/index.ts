import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useQuery, useConvex } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  calculateRateLimit,
  type GetValueArgs,
  type GetValueReturns,
} from "../shared";

export type UseRateLimitOptions = {
  name?: string;
  key?: string;
  count?: number;
  sampleShards?: number;
  getServerTimeMutation?: GetServerTimeMutation;
};

export type GetRateLimitValueQuery = FunctionReference<
  "query",
  "public",
  GetValueArgs,
  GetValueReturns
>;

export type GetServerTimeMutation = FunctionReference<
  "mutation",
  "public",
  Record<string, never>,
  number
>;

/**
 * A hook for using rate limits in React components.
 * This hook provides information about the current rate limit status,
 * including the ability to check if an action is allowed and when it can be retried.
 *
 * @param getRateLimitQuery The query function returned by rateLimiter.getter().getRateLimit
 * @param getServerTimeMutation A mutation that returns the current server time (Date.now())
 * @param sampleShards Optional number of shards to sample (default: 1)
 * @returns An object containing:
 *   - status: The current status of the rate limit (ok, retryAt)
 *     If the rate limit value is below the count (or 0 if unspecified), the
 *     retryAt will be set to the time when the client can retry.
 *   - checkValue: A function that returns the current value of the rate limit
 */
export function useRateLimit(
  getRateLimitValueQuery: GetRateLimitValueQuery,
  opts?: UseRateLimitOptions
) {
  // This is the offset between the client and server time.
  // clientTime + timeOffset = serverTime
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const refresh = useForceUpdate();

  const convex = useConvex();

  const { getServerTimeMutation, count, ...args } = opts ?? {};
  useEffect(() => {
    if (!getServerTimeMutation) return;
    const clientTime = Date.now();
    void convex
      .mutation(getServerTimeMutation, {})
      .then((serverTime: number) => {
        const latency = Date.now() - clientTime;
        setTimeOffset(serverTime - clientTime - latency / 2);
      });
  }, [convex, !!getServerTimeMutation]);

  // Based on server time
  const rateLimitData = useQuery(getRateLimitValueQuery, {
    name: args.name,
    key: args.key,
    sampleShards: args.sampleShards,
  });

  // Takes in and exposes client time
  const check = useCallback(
    (ts?: number, count?: number) => {
      if (!rateLimitData) return undefined;

      const clientTime = ts ?? Date.now();
      const serverTime = clientTime + timeOffset;
      const value = calculateRateLimit(
        rateLimitData,
        rateLimitData.config,
        serverTime,
        count
      );
      return {
        value: value.value,
        ts: value.ts - timeOffset,
        config: rateLimitData.config,
        shard: rateLimitData.shard,
        ok: value.value >= 0,
        retryAt: value.retryAfter
          ? serverTime + value.retryAfter - timeOffset
          : undefined,
      };
    },
    [rateLimitData]
  );

  const currentValue = check(Date.now(), count ?? 1);
  const ret = useMemo(() => {
    if (!currentValue) return { status: undefined, check };
    if (currentValue.value < 0) {
      return {
        status: { ok: false as const, retryAt: currentValue.retryAt! },
        check,
      };
    }
    return { status: { ok: true as const, retryAt: undefined }, check };
  }, [currentValue]);

  useEffect(() => {
    if (ret?.status?.ok !== false) return;
    const interval = setTimeout(refresh, ret.status.retryAt - Date.now());
    return () => clearTimeout(interval);
  }, [ret?.status?.ok, ret?.status?.retryAt, refresh]);

  return ret;
}

function useForceUpdate() {
  return useReducer((c) => c + 1, 0)[1];
}

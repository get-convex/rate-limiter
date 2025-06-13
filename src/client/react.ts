import { useCallback, useEffect, useReducer, useState } from "react";
import { useQuery, useConvex } from "convex/react";
import type { FunctionReference } from "convex/server";
import { calculateRateLimit, type GetValueReturns } from "../shared";

type UseRateLimitArgs = {
  name?: string;
  key?: string;
  count?: number;
  sampleShards?: number;
  getServerTimeMutation?: FunctionReference<
    "mutation",
    "public",
    Record<string, never>,
    number
  >;
};
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
 *   - getValue: A function that returns the current value of the rate limit
 *   - retryAt: A function that returns the time when the rate limit will reset
 */
export function useRateLimit(
  getRateLimitValueQuery: FunctionReference<
    "query",
    "public",
    UseRateLimitArgs,
    GetValueReturns
  >,
  opts?: UseRateLimitArgs
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
  }, [convex, getServerTimeMutation]);

  // Based on server time
  const rateLimitData = useQuery(getRateLimitValueQuery, args);

  // Takes in and exposes client time
  const checkValue = useCallback(
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

  const currentValue = checkValue(Date.now(), count ?? 1);
  const status =
    currentValue &&
    (currentValue.value < 0
      ? { ok: false as const, retryAt: currentValue.retryAt! }
      : { ok: true as const, retryAt: undefined });

  useEffect(() => {
    if (status?.ok !== false) return;
    const interval = setTimeout(refresh, status.retryAt - Date.now());
    return () => clearTimeout(interval);
  }, [status?.ok, status?.retryAt, refresh]);

  return {
    status,
    checkValue,
  };
}

function useForceUpdate() {
  return useReducer((c) => c + 1, 0)[1];
}

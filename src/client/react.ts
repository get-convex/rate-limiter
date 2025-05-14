import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { FunctionReference } from "convex/server";

/**
 * A hook for using rate limits in React components.
 * This hook provides information about the current rate limit status,
 * including the ability to check if an action is allowed and when it can be retried.
 * 
 * @param getRateLimitQuery The query function returned by rateLimiter.getter().getRateLimit
 * @param sampleShards Optional number of shards to sample (default: 1)
 * @returns An object containing:
 *   - status: The current status of the rate limit (ok, retryAt)
 *   - getValue: A function that returns the current value of the rate limit
 *   - retryAt: A function that returns the time when the rate limit will reset
 */
export function useRateLimit(
  getRateLimitQuery: FunctionReference<"query", "public", any[], {
    value: number;
    ts: number;
    windowStart?: number;
    config: {
      kind: "token bucket" | "fixed window";
      rate: number;
      period: number;
      capacity?: number;
      maxReserved?: number;
      shards?: number;
      start?: number;
    };
  }>,
  sampleShards?: number
) {
  const [timeOffset, setTimeOffset] = useState<number>(0);
  
  const rateLimitData = useQuery(getRateLimitQuery, { sampleShards });
  
  useEffect(() => {
    if (rateLimitData?.ts) {
      const clientTime = Date.now();
      const serverTime = rateLimitData.ts;
      setTimeOffset(serverTime - clientTime);
    }
  }, [rateLimitData?.ts]);
  
  const getValue = useCallback(() => {
    if (!rateLimitData) return null;
    return rateLimitData.value;
  }, [rateLimitData]);
  
  const retryAt = useCallback((count = 1) => {
    if (!rateLimitData) return null;
    
    const { value, ts, config } = rateLimitData;
    const now = Date.now() + timeOffset; // Adjust for clock skew
    
    if (value >= count) {
      return null;
    }
    
    if (config.kind === "token bucket") {
      const rate = config.rate / config.period;
      const neededValue = count - value;
      return ts + (neededValue / rate);
    } else {
      const windowStart = rateLimitData.windowStart || ts;
      const elapsedWindows = Math.floor((now - windowStart) / config.period);
      const currentWindowEnd = windowStart + (elapsedWindows + 1) * config.period;
      return currentWindowEnd;
    }
  }, [rateLimitData, timeOffset]);
  
  const status = useMemo(() => {
    if (!rateLimitData) {
      return { ok: false, retryAt: undefined };
    }
    
    const retryTime = retryAt(1);
    return {
      ok: retryTime === null,
      retryAt: retryTime,
    };
  }, [rateLimitData, retryAt]);
  
  return {
    status,
    getValue,
    retryAt,
  };
}

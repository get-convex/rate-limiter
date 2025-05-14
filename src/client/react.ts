import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { FunctionReference } from "convex/server";

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
  getRateLimitQuery: FunctionReference<"query", "public", { sampleShards?: number }, {
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
  getServerTimeMutation: FunctionReference<"mutation", "public", {}, number>,
  sampleShards?: number
) {
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [clientStartTime] = useState<number>(Date.now());
  const [elapsedClientTime, setElapsedClientTime] = useState<number>(0);
  
  const getServerTime = useMutation(getServerTimeMutation);
  
  useEffect(() => {
    const clientTime = Date.now();
    getServerTime({}).then((serverTime: number) => {
      setTimeOffset(serverTime - clientTime);
    });
  }, [getServerTime]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedClientTime(Date.now() - clientStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [clientStartTime]);
  
  const rateLimitData = useQuery(getRateLimitQuery, sampleShards !== undefined ? { sampleShards } : "skip");
  
  const getCurrentServerTime = useCallback(() => {
    return Date.now() + timeOffset;
  }, [timeOffset]);
  
  const calculateCurrentValue = useCallback(() => {
    if (!rateLimitData) return null;
    
    const { value, ts, config } = rateLimitData;
    const currentServerTime = getCurrentServerTime();
    const timeSinceUpdate = currentServerTime - ts;
    
    if (config.kind === "token bucket") {
      const rate = config.rate / config.period;
      const tokensAdded = Math.max(0, Math.floor(timeSinceUpdate * rate / 1000));
      const capacity = config.capacity || config.rate;
      return Math.min(capacity, value + tokensAdded);
    } else {
      const windowStart = rateLimitData.windowStart || ts;
      const elapsedWindows = Math.floor((currentServerTime - windowStart) / config.period);
      if (elapsedWindows > 0) {
        return config.rate; // New window, full rate limit
      }
      return value; // Same window, same value
    }
  }, [rateLimitData, getCurrentServerTime]);
  
  const getValue = useCallback(() => {
    if (!rateLimitData) return null;
    return calculateCurrentValue();
  }, [rateLimitData, calculateCurrentValue]);
  
  const retryAt = useCallback((count = 1) => {
    if (!rateLimitData) return null;
    
    const currentValue = calculateCurrentValue();
    if (!currentValue || currentValue >= count) return null;
    
    const { ts, config } = rateLimitData;
    const currentServerTime = getCurrentServerTime();
    
    if (config.kind === "token bucket") {
      const rate = config.rate / config.period;
      const neededValue = count - currentValue;
      const serverRetryTime = currentServerTime + (neededValue / rate) * 1000;
      return serverRetryTime - timeOffset;
    } else {
      const windowStart = rateLimitData.windowStart || ts;
      const windowDuration = config.period;
      const currentWindowEnd = windowStart + Math.ceil((currentServerTime - windowStart) / windowDuration) * windowDuration;
      return currentWindowEnd - timeOffset;
    }
  }, [rateLimitData, calculateCurrentValue, getCurrentServerTime, timeOffset]);
  
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

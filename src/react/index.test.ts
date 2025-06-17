/**
 * @vitest-environment jsdom
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { useRateLimit, type GetRateLimitValueQuery } from "./index.js";
import { renderHook, act } from "@testing-library/react";
import { useQuery, useConvex } from "convex/react";
import type { GetValueReturns } from "../shared.js";

// Type for the useRateLimit args to match what's in react.ts

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useConvex: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseConvex = vi.mocked(useConvex);

describe("useRateLimit", () => {
  beforeEach(() => {
    // Mock useConvex to return a mock convex client
    mockedUseConvex.mockReturnValue({
      mutation: vi.fn().mockResolvedValue(Date.now()),
    } as unknown as ReturnType<typeof useConvex>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("returns correct status when rate limit is available", () => {
    const mockQuery = {} as GetRateLimitValueQuery;
    const mockRateLimitData: GetValueReturns = {
      value: 8,
      ts: Date.now(),
      shard: 0,
      config: {
        kind: "token bucket",
        rate: 10,
        period: 60000,
      },
    };

    mockedUseQuery.mockReturnValue(mockRateLimitData);

    const { result } = renderHook(() => useRateLimit(mockQuery));

    expect(result.current.status?.ok).toBe(true);
    expect(result.current.status?.retryAt).toBeUndefined();
    expect(result.current.check()?.value).toBeCloseTo(8, 1);
  });

  test("returns correct status when rate limit is exceeded", () => {
    const mockQuery = {} as GetRateLimitValueQuery;
    const now = Date.now();
    const mockRateLimitData: GetValueReturns = {
      value: 0,
      ts: now,
      shard: 0,
      config: {
        kind: "token bucket",
        rate: 10,
        period: 60000,
      },
    };

    mockedUseQuery.mockReturnValue(mockRateLimitData);

    const { result } = renderHook(() => useRateLimit(mockQuery));

    expect(result.current.status?.ok).toBe(false);
    expect(result.current.status?.retryAt).toBeDefined();
    expect(result.current.check()?.value).toBeCloseTo(0, 1);
  });

  test("handles clock skew correctly", () => {
    vi.useFakeTimers();

    const mockQuery = {} as GetRateLimitValueQuery;
    const serverTime = Date.now() + 5000; // Server is 5 seconds ahead
    const mockRateLimitData: GetValueReturns = {
      value: 5,
      ts: serverTime,
      shard: 0,
      config: {
        kind: "token bucket",
        rate: 10,
        period: 60000,
      },
    };

    mockedUseQuery.mockReturnValue(mockRateLimitData);

    const { result } = renderHook(() => useRateLimit(mockQuery));

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.status?.ok).toBe(true);

    const checkResult = result.current.check(undefined, 6);
    expect(checkResult?.retryAt).toBeDefined();

    const expectedRetryTime = serverTime + (6 - 5) / (10 / 60000);
    expect(checkResult?.retryAt).toBeCloseTo(expectedRetryTime, -2);

    vi.useRealTimers();
  });

  test("handles fixed window rate limits correctly", () => {
    const mockQuery = {} as GetRateLimitValueQuery;
    const now = Date.now();
    const windowStart = now - 30000; // Window started 30 seconds ago
    const mockRateLimitData: GetValueReturns = {
      value: 2,
      ts: windowStart,
      shard: 0,
      config: {
        kind: "fixed window",
        rate: 10,
        period: 60000,
      },
    };

    mockedUseQuery.mockReturnValue(mockRateLimitData);

    const { result } = renderHook(() => useRateLimit(mockQuery));

    expect(result.current.status?.ok).toBe(true);

    // For fixed window, when there are tokens available, retryAt should still be defined
    // because it indicates when the next window starts
    const checkResult = result.current.check(undefined, 12); // Request more than available
    expect(checkResult?.retryAt).toBeDefined();

    const expectedRetryTime = windowStart + 60000;
    expect(checkResult?.retryAt).toBeCloseTo(expectedRetryTime, -2);
  });
});

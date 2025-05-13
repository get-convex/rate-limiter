import { describe, expect, test, vi } from "vitest";
import { useRateLimit } from "./react.js";
import { renderHook, act } from "@testing-library/react-hooks";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

describe("useRateLimit", () => {
  test("returns correct status when rate limit is available", () => {
    const mockQuery = vi.fn();
    const mockRateLimitData = {
      value: 8,
      ts: Date.now(),
      config: {
        kind: "token bucket",
        rate: 10,
        period: 60000,
      },
    };
    
    const { useQuery } = require("convex/react");
    useQuery.mockReturnValue(mockRateLimitData);
    
    const { result } = renderHook(() => useRateLimit(mockQuery));
    
    expect(result.current.status.ok).toBe(true);
    expect(result.current.status.retryAt).toBeUndefined();
    expect(result.current.getValue()).toBe(8);
  });
  
  test("returns correct status when rate limit is exceeded", () => {
    const mockQuery = vi.fn();
    const now = Date.now();
    const mockRateLimitData = {
      value: 0,
      ts: now,
      config: {
        kind: "token bucket",
        rate: 10,
        period: 60000,
      },
    };
    
    const { useQuery } = require("convex/react");
    useQuery.mockReturnValue(mockRateLimitData);
    
    const { result } = renderHook(() => useRateLimit(mockQuery));
    
    expect(result.current.status.ok).toBe(false);
    expect(result.current.status.retryAt).toBeDefined();
    expect(result.current.getValue()).toBe(0);
  });
  
  test("handles clock skew correctly", () => {
    const mockQuery = vi.fn();
    const serverTime = Date.now() + 5000; // Server is 5 seconds ahead
    const mockRateLimitData = {
      value: 5,
      ts: serverTime,
      config: {
        kind: "token bucket",
        rate: 10,
        period: 60000,
      },
    };
    
    const { useQuery } = require("convex/react");
    useQuery.mockReturnValue(mockRateLimitData);
    
    const { result } = renderHook(() => useRateLimit(mockQuery));
    
    act(() => {
      vi.runAllTimers();
    });
    
    expect(result.current.status.ok).toBe(true);
    
    const retryTime = result.current.retryAt(6);
    expect(retryTime).toBeDefined();
    
    const expectedRetryTime = serverTime + (6 - 5) / (10 / 60000);
    expect(retryTime).toBeCloseTo(expectedRetryTime);
  });
  
  test("handles fixed window rate limits correctly", () => {
    const mockQuery = vi.fn();
    const now = Date.now();
    const windowStart = now - 30000; // Window started 30 seconds ago
    const mockRateLimitData = {
      value: 2,
      ts: windowStart,
      windowStart: windowStart,
      config: {
        kind: "fixed window",
        rate: 10,
        period: 60000,
      },
    };
    
    const { useQuery } = require("convex/react");
    useQuery.mockReturnValue(mockRateLimitData);
    
    const { result } = renderHook(() => useRateLimit(mockQuery));
    
    expect(result.current.status.ok).toBe(true);
    
    const retryTime = result.current.retryAt(3);
    expect(retryTime).toBeDefined();
    
    const expectedRetryTime = windowStart + 60000;
    expect(retryTime).toBeCloseTo(expectedRetryTime);
  });
});

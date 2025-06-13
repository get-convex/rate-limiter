import { useState, useCallback, useEffect } from "react";
import { useRateLimit } from "@convex-dev/rate-limiter/react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export const RateLimitExample = () => {
  const [count, setCount] = useState(1);
  const [consumedTokens, setConsumedTokens] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const consumeTokensMutation = useMutation(api.example.consumeTokens);
  const { status, check } = useRateLimit(api.example.getRateLimit, {
    // Optional, but increases the accuracy of the retry suggestion based on
    // clock skew between client and server
    getServerTimeMutation: api.example.getServerTime,
    count: count,
  });
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    const interval = setInterval(() => {
      setValue(check(Date.now())?.value ?? null);
    }, 1000);
    return () => clearInterval(interval);
  }, [check]);

  const handleConsume = useCallback(() => {
    consumeTokensMutation({ count })
      .then(() => {
        setConsumedTokens((prev) => prev + count);
      })
      .catch((error: Error) => {
        setError(error);
      });
  }, [consumeTokensMutation, count, setConsumedTokens]);

  const formatTime = useCallback((timestamp: number | null) => {
    if (!timestamp) return "N/A";
    return new Date(timestamp).toLocaleTimeString();
  }, []);

  return (
    <div className="rate-limit-example">
      <h2>Rate Limit Example</h2>

      <div className="status-panel">
        <h3>Current Status</h3>
        <p>Available tokens: {value ?? "Loading..."}</p>
        <p>Status: {status?.ok ? "✅ OK" : "❌ Rate limited"}</p>
        {!status?.ok && status?.retryAt && (
          <p>Retry at: {formatTime(status.retryAt)}</p>
        )}
        <p>Consumed tokens: {consumedTokens}</p>
        {error && <p className="error">Error: {error.message}</p>}
      </div>

      <div className="actions-panel">
        <h3>Actions</h3>
        <div className="token-input">
          <label>
            Tokens to consume:
            <input
              type="number"
              min="1"
              max="10"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 1)}
            />
          </label>
        </div>

        <button onClick={handleConsume} disabled={!status?.ok}>
          Consume Tokens
        </button>

        <div className="retry-info">
          <p>
            Time to retry for {count} tokens:{" "}
            {formatTime(status?.retryAt ?? null)}
          </p>
        </div>
      </div>

      <div className="explanation">
        <h3>How It Works</h3>
        <p>
          This example demonstrates the <code>useRateLimit</code> hook from the
          rate-limiter component.
        </p>
        <p>The hook provides:</p>
        <ul>
          <li>
            <strong>status.ok</strong>: Whether the rate limit allows the action
          </li>
          <li>
            <strong>status.retryAt</strong>: When to retry if rate limited
          </li>
          <li>
            <strong>check(ts?, count?)</strong>: Checks the rate limiter at a
            given timestamp and for a given count, including the current value,
            ts it was based on, and when to retry
          </li>
        </ul>
        <p>
          The hook handles clock skew between client and server automatically.
        </p>
      </div>
    </div>
  );
};

export default RateLimitExample;

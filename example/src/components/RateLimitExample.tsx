import { useState, useCallback, useEffect } from "react";
import { useRateLimit } from "@convex-dev/rate-limiter/react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export const RateLimitExample = () => {
  const [count, setCount] = useState(1);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const consumeTokensMutation = useMutation(api.example.consumeTokens);
  const { status, check } = useRateLimit(api.example.getRateLimit, {
    getServerTimeMutation: api.example.getServerTime,
    count: count,
  });

  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setValue(check(Date.now())?.value ?? null);
    }, 100);
    return () => clearInterval(interval);
  }, [check]);

  const handleConsume = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await consumeTokensMutation({ count });
    } catch (error: unknown) {
      setError(error as Error);
    } finally {
      setIsLoading(false);
    }
  }, [consumeTokensMutation, count]);

  const formatRetryTime = (timestamp: number | null) => {
    if (!timestamp) return "N/A";
    return dayjs(timestamp).format("h:mm:ss A");
  };

  const getRelativeTime = (timestamp: number | null) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffSeconds = Math.ceil((timestamp - now) / 1000);

    // For short durations, show exact seconds
    if (diffSeconds <= 60) {
      if (diffSeconds <= 1) return "in the flashest of flashes";
      return `in ${diffSeconds} second${diffSeconds > 1 ? "s" : ""}`;
    }

    // For longer durations, use dayjs relative time
    return dayjs(timestamp).fromNow();
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-primary-600 to-primary-700 bg-clip-text text-transparent">
          useRateLimit Hook Demo
        </h2>
        <p className="text-lg text-gray-600">
          Real-time rate limiting with automatic clock synchronization
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Token Count Selector */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700 text-center">
              Tokens to Consume
            </p>
            <div className="flex items-center justify-center">
              <input
                type="number"
                min="1"
                max="10"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                className="w-16 px-3 py-2 border border-gray-300 rounded-lg text-center text-2xl font-bold text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
              />
            </div>
            <div className="text-center">
              <span className="text-xs text-gray-500">tokens</span>
            </div>
          </div>
        </div>

        {/* Current Status */}
        <div
          className={`rounded-2xl p-6 border-2 transition-all duration-300 ${
            status?.ok
              ? "bg-success-50 border-success-200"
              : "bg-error-50 border-error-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Status</p>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className={`w-3 h-3 rounded-full ${
                    status?.ok ? "bg-success-500" : "bg-error-500"
                  }`}
                ></div>
                <span
                  className={`font-bold text-lg ${
                    status?.ok ? "text-success-900" : "text-error-900"
                  }`}
                >
                  {status?.ok ? "Available" : "Rate Limited"}
                </span>
              </div>
            </div>
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                status?.ok ? "bg-success-500" : "bg-error-500"
              }`}
            >
              <span className="text-white text-xl">
                {status?.ok ? "✓" : "⚠"}
              </span>
            </div>
          </div>
        </div>

        {/* Available Tokens */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">
                Available Tokens
              </p>
              <p className="text-3xl font-bold text-primary-900 mt-1">
                {value !== null ? value.toFixed(1) : "..."}
              </p>
            </div>
            <div className="w-12 h-12 bg-primary-500 rounded-xl flex items-center justify-center">
              <div className="w-6 h-6 bg-white rounded-full"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions and Retry Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Actions */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <button
            onClick={handleConsume}
            disabled={!status?.ok || isLoading}
            className={`w-full px-8 py-6 rounded-xl font-bold text-xl transition-all duration-200 ${
              status?.ok && !isLoading
                ? "bg-primary-500 hover:bg-primary-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            {isLoading
              ? "Consuming..."
              : `Consume ${count} Token${count > 1 ? "s" : ""}`}
          </button>
        </div>

        {/* Retry Information */}
        {!status?.ok && status?.retryAt && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-500 rounded-xl flex items-center justify-center">
                <span className="text-white text-lg">⏱</span>
              </div>
              <div>
                <p className="font-semibold text-yellow-900">
                  Rate limit active
                </p>
                <p className="text-yellow-700">
                  Retry at{" "}
                  <span className="font-mono font-semibold">
                    {formatRetryTime(status.retryAt)}
                  </span>
                  {getRelativeTime(status.retryAt) && (
                    <span className="text-yellow-600">
                      {" "}
                      ({getRelativeTime(status.retryAt)})
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-error-50 border border-error-200 rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-error-500 rounded-xl flex items-center justify-center">
              <span className="text-white text-lg">❌</span>
            </div>
            <div>
              <p className="font-semibold text-error-900">Error occurred</p>
              <p className="text-error-700 font-mono text-sm">
                {error.message}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Code Example */}
      <div className="bg-gray-900 rounded-2xl p-6 text-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            Hook Implementation
          </h3>
          <div className="px-3 py-1 bg-gray-700 rounded-lg text-gray-300 text-xs font-mono">
            useRateLimit
          </div>
        </div>

        <pre className="text-gray-300 overflow-x-auto">
          <code>{`const { status, check } = useRateLimit(api.example.getRateLimit, {
  getServerTimeMutation: api.example.getServerTime,
  count: ${count},
});

// Real-time status checking
useEffect(() => {
  const interval = setInterval(() => {
    setValue(check(Date.now())?.value ?? null);
  }, 100);
  return () => clearInterval(interval);
}, [check]);

// Status: ${status?.ok ? "✅ Available" : "🚫 Rate Limited"}
// Available tokens: ${value !== null ? value.toFixed(1) : "Loading..."}
${!status?.ok && status?.retryAt ? `// Retry at: ${formatRetryTime(status.retryAt)}` : ""}`}</code>
        </pre>
      </div>

      {/* How It Works */}
      <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">
          How useRateLimit Works
        </h3>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="p-4 bg-white rounded-xl border border-gray-200">
              <h4 className="font-semibold text-primary-700 mb-2">
                Real-time Status
              </h4>
              <p className="text-sm text-gray-600">
                The hook provides live status updates and automatically handles
                clock synchronization between client and server.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-gray-200">
              <h4 className="font-semibold text-success-700 mb-2">
                Smart Retry Logic
              </h4>
              <p className="text-sm text-gray-600">
                When rate limited, the hook calculates the exact retry time and
                provides both absolute and relative timestamps.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-white rounded-xl border border-gray-200">
              <h4 className="font-semibold text-yellow-700 mb-2">
                Clock Synchronization
              </h4>
              <p className="text-sm text-gray-600">
                Automatically handles clock skew between client and server for
                accurate rate limit timing.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-gray-200">
              <h4 className="font-semibold text-purple-700 mb-2">
                Type Safety
              </h4>
              <p className="text-sm text-gray-600">
                Fully typed React hook with automatic inference of rate limit
                configuration and state.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RateLimitExample;

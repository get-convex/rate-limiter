import { useState, useCallback, useMemo, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Monitor } from "./Monitor";

interface ConsumptionEvent {
  timestamp: number;
  count: number;
  success: boolean;
}

export const Playground = () => {
  // Configuration state
  const [strategy, setStrategy] = useState<"token bucket" | "fixed window">(
    "token bucket",
  );
  const [period, setPeriod] = useState(2); // seconds
  const rate = 1; // Fixed at 1 token per period
  const [capacity, setCapacity] = useState(3); // max tokens (1-5)

  // UI state
  const [consumptionHistory, setConsumptionHistory] = useState<
    ConsumptionEvent[]
  >([]);

  // Create the config object
  const config = useMemo(
    () => ({
      kind: strategy,
      rate,
      period: period * 1000, // convert to milliseconds
      capacity,
    }),
    [strategy, rate, period, capacity],
  );

  // API calls
  const consumeTokens = useMutation(api.playground.consumeRateLimit);
  const resetRateLimit = useMutation(api.playground.resetRateLimit);

  // Create getCurrentValue function for Monitor
  // Helper functions
  const handleConsume = useCallback(
    async (count: number) => {
      try {
        const result = await consumeTokens({
          config,
          count,
          reserve: false,
        });

        const event: ConsumptionEvent = {
          timestamp: Date.now(),
          count,
          success: result.ok,
        };

        setConsumptionHistory((prev) => [...prev, event]);
      } catch (error) {
        console.error("Failed to consume tokens:", error);
        const event: ConsumptionEvent = {
          timestamp: Date.now(),
          count,
          success: false,
        };
        setConsumptionHistory((prev) => [...prev, event]);
      }
    },
    [consumeTokens, config],
  );

  const handleReset = useCallback(async () => {
    try {
      await resetRateLimit({});
      setConsumptionHistory([]);
    } catch (error) {
      console.error("Failed to reset rate limit:", error);
    }
  }, [resetRateLimit]);

  // Calculate consumption stats
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const consumedLast10s = consumptionHistory
    .filter((event) => now - event.timestamp < 10000 && event.success)
    .reduce((sum, event) => sum + event.count, 0);

  const consumedLast100s = consumptionHistory
    .filter((event) => now - event.timestamp < 100000 && event.success)
    .reduce((sum, event) => sum + event.count, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      <div className="w-full max-w-7xl mx-auto p-6 space-y-8 animate-fade-in">
        {/* Header */}
        <div className="text-center space-y-4 py-8">
          <h2 className="text-4xl font-bold bg-gradient-to-r from-primary-600 to-primary-700 bg-clip-text text-transparent">
            Rate Limiter Playground
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Experiment with different rate limiting strategies and watch how
            they behave in real-time
          </p>
        </div>

        {/* Configuration Panel */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 animate-slide-up">
          <h3 className="text-xl font-semibold text-gray-800 mb-8 text-center flex items-center justify-center">
            <div className="w-2 h-2 bg-primary-500 rounded-full mr-3"></div>
            Configuration
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Strategy Pill Selector */}
            <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
              <label className="block text-sm font-medium text-gray-700 text-center">
                Strategy
              </label>
              <div className="bg-white rounded-xl p-1 flex shadow-sm border border-gray-200">
                <button
                  onClick={() => setStrategy("token bucket")}
                  className={`flex-1 py-3 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${
                    strategy === "token bucket"
                      ? "bg-primary-500 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  Token Bucket
                </button>
                <button
                  onClick={() => setStrategy("fixed window")}
                  className={`flex-1 py-3 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${
                    strategy === "fixed window"
                      ? "bg-primary-500 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  Fixed Window
                </button>
              </div>
            </div>

            {/* Period Input */}
            <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
              <label className="block text-sm font-medium text-gray-700 text-center">
                Rate Limit
              </label>
              <div className="flex items-center justify-center space-x-3 bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <span className="text-lg font-semibold text-gray-900">
                  1 per
                </span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={period}
                  onChange={(e) =>
                    setPeriod(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  className="w-16 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-center font-semibold focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                />
                <span className="text-lg font-semibold text-gray-900">
                  seconds
                </span>
              </div>
            </div>

            {/* Capacity Slider */}
            <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
              <label className="block text-sm font-medium text-gray-700 text-center">
                Capacity:{" "}
                <span className="text-primary-600 font-semibold">
                  {capacity}
                </span>{" "}
                tokens
              </label>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={capacity}
                  onChange={(e) => setCapacity(parseInt(e.target.value))}
                  className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Visualization */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden animate-slide-up">
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-xl font-semibold text-gray-800 flex items-center">
              <div className="w-2 h-2 bg-primary-500 rounded-full mr-3"></div>
              Real-time Timeline
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Token availability and consumption over the last 10 seconds
            </p>
          </div>
          <Monitor
            getRateLimitValueQuery={api.playground.getRateLimit}
            consumptionHistory={consumptionHistory}
            opts={{
              name: "demo",
              config,
              getServerTimeMutation: api.playground.getServerTime,
            }}
          />
          <div className="p-6">
            {/* Legend */}
            <div className="mt-6 flex flex-wrap gap-6 justify-center text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-gradient-to-r from-primary-500 to-primary-700 rounded"></div>
                <span className="text-gray-700 font-medium">
                  Available tokens
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-success-500 rounded-full border border-white"></div>
                <span className="text-gray-700 font-medium">
                  Successful consumption
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-error-500 rounded-full border border-white"></div>
                <span className="text-gray-700 font-medium">
                  Failed consumption
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-yellow-500"></div>
                <span className="text-gray-700 font-medium">
                  Capacity limit
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <button
                onClick={() => handleConsume(1)}
                className="px-8 py-4 bg-gradient-to-r from-primary-500 to-primary-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-primary-600 hover:to-primary-700 transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
              >
                <div className="w-5 h-5 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold">1</span>
                </div>
                Consume 1 Token
              </button>

              <button
                onClick={() => handleConsume(2)}
                className="px-8 py-4 bg-gradient-to-r from-success-500 to-success-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-success-600 hover:to-success-700 transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
              >
                <div className="w-5 h-5 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold">2</span>
                </div>
                Consume 2 Tokens
              </button>

              <button
                onClick={handleReset}
                className="px-8 py-4 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:from-gray-600 hover:to-gray-700 transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
              >
                <div className="w-5 h-5 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <span className="text-xs font-bold">↻</span>
                </div>
                Reset Rate Limit
              </button>
            </div>

            {/* Token Consumption Stats */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="bg-success-50 rounded-lg p-4 border border-success-200">
                <div className="text-center">
                  <p className="text-sm font-medium text-success-700">
                    Consumed (10s)
                  </p>
                  <p className="text-2xl font-bold text-success-900">
                    {consumedLast10s}
                  </p>
                </div>
              </div>
              <div className="bg-success-50 rounded-lg p-4 border border-success-200">
                <div className="text-center">
                  <p className="text-sm font-medium text-success-700">
                    Consumed (100s)
                  </p>
                  <p className="text-2xl font-bold text-success-900">
                    {consumedLast100s}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-200 p-8 animate-slide-up">
          <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center">
            <div className="w-3 h-3 bg-primary-500 rounded-full mr-3"></div>
            How Rate Limiting Works
          </h3>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-xl border border-gray-200">
                <h4 className="font-semibold text-primary-700 mb-2">
                  Token Bucket Strategy
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Tokens are added continuously at the specified rate. Unused
                  tokens accumulate up to the capacity, allowing for bursty
                  traffic when needed.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-gray-200">
                <h4 className="font-semibold text-primary-700 mb-2">
                  Fixed Window Strategy
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  All tokens are granted at the start of each time window.
                  Simpler but can allow sudden bursts at window boundaries.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-white rounded-xl border border-gray-200">
                <h4 className="font-semibold text-success-700 mb-2">
                  Success Indicators
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Green bars show successful token consumption. The timeline
                  drops immediately to reflect the new available token count.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-gray-200">
                <h4 className="font-semibold text-error-700 mb-2">
                  Rate Limited
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Red bars indicate failed consumption attempts when there
                  aren't enough tokens available. The timeline shows how long to
                  wait.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Playground;

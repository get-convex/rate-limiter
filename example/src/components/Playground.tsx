import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { calculateRateLimit } from "../../../src/shared";

interface ConsumptionEvent {
  timestamp: number;
  count: number;
  success: boolean;
}

export const Playground = () => {
  // Configuration state
  const [strategy, setStrategy] = useState<"token bucket" | "fixed window">(
    "token bucket"
  );
  const [period, setPeriod] = useState(60); // seconds
  const [rate, setRate] = useState(10); // tokens per period
  const [capacity, setCapacity] = useState(10); // max tokens

  // UI state
  const [consumptionHistory, setConsumptionHistory] = useState<
    ConsumptionEvent[]
  >([]);
  const [timelineData, setTimelineData] = useState<
    Array<{ timestamp: number; value: number }>
  >([]);

  // Create the config object
  const config = {
    kind: strategy,
    rate,
    period: period * 1000, // convert to milliseconds
    capacity,
  };

  // API calls
  const rateLimit = useQuery(api.playground.getValue, { config });
  const consumeTokens = useMutation(api.playground.consumeRateLimit);
  const resetRateLimit = useMutation(api.playground.resetRateLimit);

  // Timeline visualization logic
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  // Update timeline data every 250ms with calculated values
  useEffect(() => {
    if (!rateLimit) return;

    const updateTimeline = () => {
      const now = Date.now();
      // Calculate current value using the rate limit calculation
      const currentState = { value: rateLimit.value, ts: rateLimit.ts };
      const calculated = calculateRateLimit(
        currentState,
        rateLimit.config,
        now,
        0
      );
      const newPoint = { timestamp: now, value: calculated.value };

      setTimelineData((prev) => {
        const filtered = prev.filter((point) => now - point.timestamp < 10000); // Keep last 10 seconds
        return [...filtered, newPoint];
      });
    };

    // Initial update
    updateTimeline();

    // Set up interval for regular updates
    const interval = setInterval(updateTimeline, 250);

    return () => {
      clearInterval(interval);
    };
  }, [rateLimit]);

  // Draw timeline
  const drawTimeline = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const now = Date.now();
    const tenSecondsAgo = now - 10000;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set up drawing parameters
    const padding = 40;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // Draw axes
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    // X-axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Draw capacity line (dashed)
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "#999";
    const capacityY =
      height - padding - (capacity / (capacity + 2)) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(padding, capacityY);
    ctx.lineTo(width - padding, capacityY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw timeline data
    if (timelineData.length > 0) {
      ctx.strokeStyle = "#007bff";
      ctx.lineWidth = 2;
      ctx.beginPath();

      timelineData.forEach((point, index) => {
        const x =
          padding + ((point.timestamp - tenSecondsAgo) / 10000) * plotWidth;
        const y =
          height -
          padding -
          (Math.max(0, point.value) / (capacity + 2)) * plotHeight;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw current value label
      if (timelineData.length > 0) {
        const lastPoint = timelineData[timelineData.length - 1];
        const x =
          padding + ((lastPoint.timestamp - tenSecondsAgo) / 10000) * plotWidth;
        const y =
          height -
          padding -
          (Math.max(0, lastPoint.value) / (capacity + 2)) * plotHeight;

        // Draw label box
        ctx.fillStyle = "#007bff";
        ctx.fillRect(x + 5, y - 15, 60, 20);
        ctx.fillStyle = "white";
        ctx.font = "12px Arial";
        ctx.fillText(`${Math.round(lastPoint.value)}`, x + 10, y - 2);
      }
    }

    // Draw consumption bars
    const now10s = now;
    const recentEvents = consumptionHistory.filter(
      (event) => now10s - event.timestamp < 10000
    );

    recentEvents.forEach((event) => {
      const x =
        padding + ((event.timestamp - tenSecondsAgo) / 10000) * plotWidth;
      const barHeight = (event.count / (capacity + 2)) * plotHeight;

      // Find the value at this timestamp to position the bar correctly
      const valueAtTime =
        timelineData.find(
          (point) => Math.abs(point.timestamp - event.timestamp) < 1000
        )?.value ?? 0;

      // Top of the bar should be at the value line
      const topY =
        height -
        padding -
        (Math.max(0, valueAtTime) / (capacity + 2)) * plotHeight;

      ctx.fillStyle = event.success ? "#28a745" : "#dc3545";
      // Draw bar going downward from the value line
      ctx.fillRect(x - 2, topY, 4, barHeight);
    });

    // Draw axis labels
    ctx.fillStyle = "#666";
    ctx.font = "12px Arial";

    // Y-axis labels
    for (
      let i = 0;
      i <= capacity + 2;
      i += Math.max(1, Math.floor((capacity + 2) / 5))
    ) {
      const y = height - padding - (i / (capacity + 2)) * plotHeight;
      ctx.fillText(i.toString(), 5, y + 4);
    }

    // X-axis labels
    ctx.fillText("10s ago", padding, height - 10);
    ctx.fillText("now", width - padding - 20, height - 10);

    // Schedule next frame
    animationRef.current = requestAnimationFrame(drawTimeline);
  }, [timelineData, consumptionHistory, capacity]);

  // Start animation loop
  useEffect(() => {
    drawTimeline();
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawTimeline]);

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
    [consumeTokens, config]
  );

  const handleReset = useCallback(async () => {
    try {
      await resetRateLimit({});
      setConsumptionHistory([]);
      setTimelineData([]);
    } catch (error) {
      console.error("Failed to reset rate limit:", error);
    }
  }, [resetRateLimit]);

  // Calculate consumption stats
  const now = Date.now();
  const consumedLast10s = consumptionHistory
    .filter((event) => now - event.timestamp < 10000 && event.success)
    .reduce((sum, event) => sum + event.count, 0);

  const consumedLast100s = consumptionHistory
    .filter((event) => now - event.timestamp < 100000 && event.success)
    .reduce((sum, event) => sum + event.count, 0);

  // Get current value from timeline data
  const currentValue =
    timelineData.length > 0
      ? Math.max(0, timelineData[timelineData.length - 1].value)
      : 0;

  return (
    <div
      className="playground"
      style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}
    >
      <h2>Rate Limiter Playground</h2>

      {/* Configuration Panel */}
      <div
        className="config-panel"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
          padding: "20px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          backgroundColor: "#f9f9f9",
        }}
      >
        <div>
          <label>
            Strategy:
            <select
              value={strategy}
              onChange={(e) =>
                setStrategy(e.target.value as "token bucket" | "fixed window")
              }
              style={{ marginLeft: "10px", padding: "5px" }}
            >
              <option value="token bucket">Token Bucket</option>
              <option value="fixed window">Fixed Window</option>
            </select>
          </label>
        </div>

        <div>
          <label>
            Period (seconds): {period}
            <input
              type="range"
              min="1"
              max="30"
              value={period}
              onChange={(e) => setPeriod(parseInt(e.target.value))}
              style={{ width: "100%", marginTop: "5px" }}
            />
          </label>
        </div>

        <div>
          <label>
            Rate (tokens per period): {rate}
            <input
              type="range"
              min="1"
              max="30"
              value={rate}
              onChange={(e) => setRate(parseInt(e.target.value))}
              style={{ width: "100%", marginTop: "5px" }}
            />
          </label>
        </div>

        <div>
          <label>
            Capacity (burst): {capacity}
            <input
              type="range"
              min={rate}
              max={rate * 3}
              value={capacity}
              onChange={(e) => setCapacity(parseInt(e.target.value))}
              style={{ width: "100%", marginTop: "5px" }}
            />
          </label>
        </div>
      </div>

      {/* Status Panel */}
      <div
        className="status-panel"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "15px",
          marginBottom: "30px",
          padding: "15px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          backgroundColor: "#f0f8ff",
        }}
      >
        <div>
          <strong>Available Tokens:</strong>
          <br />
          <span style={{ fontSize: "24px", color: "#007bff" }}>
            {Math.round(currentValue)}
          </span>
        </div>
        <div>
          <strong>Consumed (10s):</strong>
          <br />
          <span style={{ fontSize: "18px", color: "#28a745" }}>
            {consumedLast10s}
          </span>
        </div>
        <div>
          <strong>Consumed (100s):</strong>
          <br />
          <span style={{ fontSize: "18px", color: "#28a745" }}>
            {consumedLast100s}
          </span>
        </div>
        <div>
          <strong>Strategy:</strong>
          <br />
          <span style={{ fontSize: "16px" }}>{strategy}</span>
        </div>
      </div>

      {/* Timeline Visualization */}
      <div className="timeline-panel" style={{ marginBottom: "30px" }}>
        <h3>Timeline Visualization</h3>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: "8px",
            backgroundColor: "white",
            padding: "10px",
          }}
        >
          <canvas
            ref={canvasRef}
            width={800}
            height={300}
            style={{ width: "100%", height: "300px", border: "1px solid #eee" }}
          />
          <div style={{ marginTop: "10px", fontSize: "14px", color: "#666" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <div
                  style={{
                    width: "20px",
                    height: "2px",
                    backgroundColor: "#007bff",
                  }}
                ></div>
                <span>Available tokens</span>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <div
                  style={{
                    width: "4px",
                    height: "20px",
                    backgroundColor: "#28a745",
                  }}
                ></div>
                <span>Successful consumption</span>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <div
                  style={{
                    width: "4px",
                    height: "20px",
                    backgroundColor: "#dc3545",
                  }}
                ></div>
                <span>Failed consumption</span>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <div
                  style={{
                    width: "20px",
                    height: "1px",
                    backgroundColor: "#999",
                    borderTop: "1px dashed #999",
                  }}
                ></div>
                <span>Capacity limit</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div
        className="actions-panel"
        style={{
          display: "flex",
          gap: "15px",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => handleConsume(1)}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Consume 1 Token
        </button>

        <button
          onClick={() => handleConsume(4)}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Consume 4 Tokens
        </button>

        <button
          onClick={handleReset}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            backgroundColor: "#dc3545",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Reset Rate Limit
        </button>
      </div>

      {/* Explanation */}
      <div
        className="explanation"
        style={{
          marginTop: "40px",
          padding: "20px",
          backgroundColor: "#f8f9fa",
          borderRadius: "8px",
          fontSize: "14px",
          lineHeight: "1.6",
        }}
      >
        <h3>How It Works</h3>
        <p>
          This playground demonstrates different rate limiting strategies with
          real-time visualization.
        </p>
        <ul>
          <li>
            <strong>Token Bucket:</strong> Tokens are added continuously at the
            specified rate. Unused tokens accumulate up to the capacity,
            allowing for bursty traffic.
          </li>
          <li>
            <strong>Fixed Window:</strong> All tokens are granted at the start
            of each time window. Simpler but can allow sudden bursts at window
            boundaries.
          </li>
          <li>
            <strong>Timeline:</strong> Shows token availability over the last 10
            seconds with consumption events.
          </li>
          <li>
            <strong>Green bars:</strong> Successful token consumption
          </li>
          <li>
            <strong>Red bars:</strong> Failed consumption attempts (rate
            limited)
          </li>
        </ul>
      </div>
    </div>
  );
};

export default Playground;

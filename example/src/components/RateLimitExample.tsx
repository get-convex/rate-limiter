import { useState, useEffect, useCallback, useMemo } from 'react';

const useRateLimitMock = (initialValue = 10, maxValue = 10, refillRate = 1) => {
  const [value, setValue] = useState(initialValue);
  const [, setLastUpdate] = useState(Date.now());
  const [timeOffset, setTimeOffset] = useState(0);
  const [clientStartTime] = useState(Date.now());
  
  useEffect(() => {
    const clientTime = Date.now();
    setTimeout(() => {
      const simulatedServerTime = Date.now() + 50; // Add 50ms to simulate clock skew
      setTimeOffset(simulatedServerTime - clientTime);
      console.log(`Clock skew detected: ${simulatedServerTime - clientTime}ms`);
    }, 200);
  }, []);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(Date.now());
      setValue(prev => Math.min(maxValue, prev + refillRate / 10));
    }, 1000);
    return () => clearInterval(interval);
  }, [maxValue, refillRate]);
  
  const getCurrentServerTime = useCallback(() => {
    return Date.now() + timeOffset;
  }, [timeOffset]);
  
  const getValue = useCallback(() => {
    return value;
  }, [value]);
  
  const retryAt = useCallback((count = 1) => {
    if (value >= count) return null;
    
    const neededTokens = count - value;
    const timeToRefill = (neededTokens / refillRate) * 1000;
    
    const serverRetryTime = getCurrentServerTime() + timeToRefill;
    return serverRetryTime - timeOffset;
  }, [value, refillRate, timeOffset, getCurrentServerTime]);
  
  const status = useMemo(() => {
    const retryTime = retryAt(1);
    return {
      ok: retryTime === null,
      retryAt: retryTime,
    };
  }, [retryAt]);
  
  return {
    status,
    getValue,
    retryAt,
  };
};

export const RateLimitExample = () => {
  const [count, setCount] = useState(1);
  const [consumedTokens, setConsumedTokens] = useState(0);
  
  // const { status, getValue, retryAt } = useRateLimit(api.rateLimiter.getRateLimit);
  
  const { status, getValue, retryAt } = useRateLimitMock(8, 10, 1);
  
  const handleConsume = () => {
    if (status.ok) {
      setConsumedTokens(prev => prev + count);
    }
  };
  
  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleTimeString();
  };
  
  return (
    <div className="rate-limit-example">
      <h2>Rate Limit Example</h2>
      
      <div className="status-panel">
        <h3>Current Status</h3>
        <p>Available tokens: {getValue() ?? 'Loading...'}</p>
        <p>Status: {status.ok ? '✅ OK' : '❌ Rate limited'}</p>
        {!status.ok && status.retryAt && (
          <p>Retry after: {formatTime(status.retryAt)}</p>
        )}
        <p>Consumed tokens: {consumedTokens}</p>
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
        
        <button 
          onClick={handleConsume}
          disabled={!status.ok}
        >
          Consume Tokens
        </button>
        
        <div className="retry-info">
          <p>Time to retry for {count} tokens: {formatTime(retryAt(count))}</p>
        </div>
      </div>
      
      <div className="explanation">
        <h3>How It Works</h3>
        <p>This example demonstrates the <code>useRateLimit</code> hook from the rate-limiter component.</p>
        <p>The hook provides:</p>
        <ul>
          <li><strong>status.ok</strong>: Whether the rate limit allows the action</li>
          <li><strong>status.retryAt</strong>: When to retry if rate limited</li>
          <li><strong>getValue()</strong>: Current available token count</li>
          <li><strong>retryAt(count)</strong>: Calculate when you can retry for a specific token count</li>
        </ul>
        <p>The hook handles clock skew between client and server automatically.</p>
      </div>
    </div>
  );
};

export default RateLimitExample;

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useRateLimit } from '../../../src/client/react';

export const RateLimitExample = () => {
  const [count, setCount] = useState(1);
  const [consumedTokens, setConsumedTokens] = useState(0);
  
  const consumeTokensMutation = useMutation(api.example.consumeTokens);
  const { status, getValue, retryAt } = useRateLimit(api.example.getRateLimit, api.example.getServerTime);
  
  const handleConsume = () => {
    if (status.ok) {
      consumeTokensMutation({ count })
        .then(() => {
          setConsumedTokens(prev => prev + count);
        })
        .catch(error => {
          console.error("Failed to consume tokens:", error);
        });
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

import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import RateLimitExample from './components/RateLimitExample'

function App() {
  const [showExample, setShowExample] = useState(false)

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Rate Limiter Example</h1>
      <div className="card">
        <button onClick={() => setShowExample(!showExample)}>
          {showExample ? 'Hide' : 'Show'} Rate Limiter Example
        </button>
        
        {showExample && (
          <div className="example-container">
            <RateLimitExample />
          </div>
        )}
      </div>
      <p className="read-the-docs">
        This example demonstrates the useRateLimit hook from the rate-limiter component
      </p>
    </>
  )
}

export default App

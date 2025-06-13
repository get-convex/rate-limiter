import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import RateLimitExample from "./components/RateLimitExample";
import Playground from "./components/Playground";

function App() {
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
      <h1>Rate Limiter Examples</h1>
      <div className="card">
        <div className="example-container">
          <Playground />
          <hr style={{ margin: "40px 0", border: "1px solid #ddd" }} />
          <RateLimitExample />
        </div>
      </div>
      <p className="read-the-docs">
        These examples demonstrate the rate-limiter component with interactive
        visualization and basic usage patterns
      </p>
    </>
  );
}

export default App;

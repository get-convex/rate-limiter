import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import RateLimitExample from "./components/RateLimitExample";
import Playground from "./components/Playground";

function App() {
  return (
    <>
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

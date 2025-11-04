# Rate Limiter Example App

This example demonstrates how to use the rate-limiter component's React hook in
a Vite application.

## Features

- Demonstrates the `useRateLimit` hook from the rate-limiter component
- Shows how to check available tokens and calculate retry times
- Visualizes token bucket refill over time
- Handles clock skew between client and server

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open your browser to the URL shown in the terminal (usually
   http://localhost:5173)

## How It Works

The example app demonstrates:

- How to use the useRateLimit hook in a React component
- How the hook provides status information (ok, retryAt)
- How to check available tokens and calculate retry times
- How the hook handles token refill over time and clock skew

## Implementation Details

The `useRateLimit` hook:

- Calculates clock skew between client and server using a one-time mutation
- Provides real-time token availability information
- Calculates retry times based on token consumption rate
- Supports both token bucket and fixed window rate limiting strategies

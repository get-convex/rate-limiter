# Changelog

## 0.2.8 alpha

- Add `useRateLimit` hook in `@convex-dev/rate-limiter/react` along with a helper
  to define an API for the hook to watch a rate limit value from the client.
  React: `const { status, check } = useRateLimit(api.example.getRateLimit);
  Server: `export const { getRateLimit } = rateLimiter.hookAPI("myratelimit");`
  You can also export a `getServerTime` and pass a reference to the hook so it can
  adjust for clock differences between the browser & server.
  `useRateLimit(api.example.getRateLimit, { getServerTimeMutation: api.example.getServerTime })`
  Server: `export const { getRateLimit, getServerTime } = rateLimiter.hookAPI("myratelimit");`


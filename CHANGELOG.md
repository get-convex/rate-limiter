# Changelog

## 0.2.14

- Adds a /test endpoint to ease testing

## 0.2.13

- Support React 18.2.0 explicitly

## 0.2.12

- Limit ctx arg type to not require supporting "public" function running

## 0.2.11

- Allow passing config to hookAPI

## 0.2.10

- Throws on reservations going negative when reserve & throws both passed to check

## 0.2.9

- Passing `throw: true` and `reserve: true` will throw if it would have returned a `retryAfter`,
  not `ok === false`.
- The return value of the hook is now stable to use as deps, and always returns { status, check }

## 0.2.8

- Add `useRateLimit` hook in `@convex-dev/rate-limiter/react` along with a helper
  to define an API for the hook to watch a rate limit value from the client.
  React: `const { status, check } = useRateLimit(api.example.getRateLimit);
Server: `export const { getRateLimit } = rateLimiter.hookAPI("myratelimit");`You can also export a`getServerTime`and pass a reference to the hook so it can
adjust for clock differences between the browser & server.`useRateLimit(api.example.getRateLimit, { getServerTimeMutation: api.example.getServerTime })`Server:`export const { getRateLimit, getServerTime } = rateLimiter.hookAPI("myratelimit");`

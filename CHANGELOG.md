# Changelog

## Unreleased

- Adds `lazy` rate limits, which check a recent database snapshot and queue
  their consumption for a batch worker to apply, so any number of concurrent
  requests can share one limit without OCC conflicts. Reads (`limit`, `check`,
  `getValue`) subtract the queued consumption, so bursts stay bounded. `lazy`
  and `shards` are mutually exclusive, enforced by the types.
- Requires `convex@^1.43.0` (for `v.commitTs()` and stale snapshot reads), and
  depends on the [batch worker](https://github.com/get-convex/batch-worker)
  component.
- `RateLimiter`'s ctx types now include `meta`, used to detect whether `check`
  is running inside a mutation.
- Inline `config` arguments accept the looser `RateLimitConfigValue` shape, so a
  config that arrived over the wire can be passed straight through.

## 0.3.2

- Pass client-provided keys to the key function, don't trust them by default.
  This was a quick follow-up to 0.3.1 to prevent passing arbitrary keys from the
  client un-validated

## 0.3.1

- Allow client-provided key for rate limiter hooks (credit: marcoshernanz)
- Add consts for WEEK and DAY (credit: marwand)

## 0.3.0

- Adds /test and /\_generated/component.js entrypoints
- Drops commonjs support
- Improves source mapping for generated files
- Changes to a statically generated component API

## 0.2.14

- Adds a /test endpoint to ease testing

## 0.2.13

- Support React 18.2.0 explicitly

## 0.2.12

- Limit ctx arg type to not require supporting "public" function running

## 0.2.11

- Allow passing config to hookAPI

## 0.2.10

- Throws on reservations going negative when reserve & throws both passed to
  check

## 0.2.9

- Passing `throw: true` and `reserve: true` will throw if it would have returned
  a `retryAfter`, not `ok === false`.
- The return value of the hook is now stable to use as deps, and always returns
  { status, check }

## 0.2.8

- Add `useRateLimit` hook in `@convex-dev/rate-limiter/react` along with a
  helper to define an API for the hook to watch a rate limit value from the
  client. React:
  `const { status, check } = useRateLimit(api.example.getRateLimit); Server: `export
  const { getRateLimit } =
  rateLimiter.hookAPI("myratelimit");`You can also export a`getServerTime`and pass a reference to the hook so it can adjust for clock differences between the browser & server.`useRateLimit(api.example.getRateLimit,
  { getServerTimeMutation: api.example.getServerTime })`Server:`export const {
  getRateLimit, getServerTime } = rateLimiter.hookAPI("myratelimit");`

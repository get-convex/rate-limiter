# Changelog

## Unreleased

- Adds asynchronous consumption: `limit(ctx, name, { async: true })` checks the
  limit against a recent database snapshot and queues the consumption for a
  batch worker to fold in, so any number of concurrent requests can share one
  limit without OCC conflicts.
- `check` and `getValue` take a matching `stale: true`, which adds in
  consumption the worker hasn't applied yet (and, from a mutation, reads without
  taking a read dependency on the limit). `hookAPI` takes it too.
- The flags are per call and are not enforced across calls: a synchronous call
  on a limit consumed asynchronously will over-admit and conflict with the
  worker. Use one mode per limit.
- `async`/`stale` can't be combined with `shards`, since the worker only writes
  the singleton shard. That's a type error for a limit defined on the client,
  and a runtime error for an inline config.
- Requires `convex@^1.43.0` (for `v.commitTs()` and stale snapshot reads), and
  depends on the [batch worker](https://github.com/get-convex/batch-worker)
  component.
- `RateLimiter.check` asks for `meta` on its ctx only when `stale` is passed, so
  existing calls — including those with a ctx narrowed to the exported
  `QueryCtx`/`MutationCtx`/`ActionCtx` — are unaffected.

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

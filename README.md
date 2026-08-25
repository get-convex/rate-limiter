# Convex Rate Limiter Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Frate-limiter.svg)](https://badge.fury.io/js/@convex-dev%2Frate-limiter)

<!-- START: Include on https://convex.dev/components -->

This component provides application-level rate limiting.

Teaser:

```ts
const rateLimiter = new RateLimiter(components.rateLimiter, {
  freeTrialSignUp: { kind: "fixed window", rate: 100, period: HOUR },
  sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
});

// Restrict how fast free users can sign up to deter bots
const status = await rateLimiter.limit(ctx, "freeTrialSignUp");

// Limit how fast a user can send messages
const status = await rateLimiter.limit(ctx, "sendMessage", { key: userId });

// Use the React hook to check the rate limit
const { status, check } = useRateLimit(api.example.getRateLimit, { count });
```

See below for more details on usage.

**What is rate limiting?**

Rate limiting is the technique of controlling how often actions can be
performed, typically on a server. There are a host of options for achieving
this, most of which operate at the network layer.

**What is application-layer rate limiting?**

Application-layer rate limiting happens in your app's code where you are
handling authentication, authorization, and other business logic. It allows you
to define nuanced rules, and enforce policies more fairly. It is not the first
line of defense for a sophisticated DDOS attack (which thankfully are extremely
rare), but will serve most real-world use cases.

**What differentiates this approach?**

- Type-safe usage: you won't accidentally misspell a rate limit name.
- Configurable for fixed window or token bucket algorithms.
- Efficient storage and compute: storage is not proportional to requests.
- Configurable sharding for scalability, or asynchronous consumption for
  unbounded write throughput.
- Transactional evaluation: all rate limit changes will roll back if your
  mutation fails.
- Fairness guarantees via credit "reservation": save yourself from exponential
  backoff.
- Opt-in "rollover" or "burst" allowance via a configurable `capacity`.
- Fails closed, not open: avoid cascading failure when traffic overwhelms your
  rate limits.

See the associated [Stack post](https://stack.convex.dev/rate-limiting) for more
details and background.

## Pre-requisite: Convex

You'll need an existing Convex project to use the component. Convex is a hosted
backend platform, including a database, serverless functions, and a ton more you
can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the
[quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

Install the component package:

```ts
npm install @convex-dev/rate-limiter
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the
component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);

export default app;
```

## Define your rate limits:

```ts
import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  // One global / singleton rate limit, using a "fixed window" algorithm.
  freeTrialSignUp: { kind: "fixed window", rate: 100, period: HOUR },
  // A per-user limit, allowing one every ~6 seconds.
  // Allows up to 3 in quick succession if they haven't sent many recently.
  sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
  failedLogins: { kind: "token bucket", rate: 10, period: HOUR },
  // Use sharding to increase throughput without compromising on correctness.
  llmTokens: { kind: "token bucket", rate: 40000, period: MINUTE, shards: 10 },
  llmRequests: { kind: "fixed window", rate: 1000, period: MINUTE, shards: 10 },
});
```

For limits hot enough that sharding isn't enough, consume them asynchronously —
see [below](#scaling-past-sharding-with-async-consumption).

- You can safely generate multiple instances if you want to define different
  rates in separate places, provided the keys don't overlap.
- The units for `period` are milliseconds. `MINUTE` above is `60000`.

### Strategies:

The **`token bucket`** approach provides guarantees for overall consumption via
the `rate` per `period` at which tokens are added, while also allowing unused
tokens to accumulate (like "rollover" minutes) up to some `capacity` value. So
if you could normally send 10 per minute, with a capacity of 20, then every two
minutes you could send 20, or if in the last two minutes you only sent 5, you
can send 15 now.

The **`fixed window`** approach differs in that the tokens are granted all at
once, every `period` milliseconds. It similarly allows accumulating "rollover"
tokens up to a `capacity` (defaults to the `rate` for both rate limit
strategies). You can specify a custom `start` time if e.g. you want the period
to reset at a specific time of day. By default it will be random to help space
out requests that are retrying.

## Usage

### Using a simple global rate limit:

```ts
const { ok, retryAfter } = await rateLimiter.limit(ctx, "freeTrialSignUp");
```

- `ok` is whether it successfully consumed the resource
- `retryAfter` is when it would have succeeded in the future.

**Note**: If you have many clients using the `retryAfter` to decide when to
retry, defend against a
[thundering herd](https://en.wikipedia.org/wiki/Thundering_herd_problem) by
adding some [jitter](#adding-jitter). Or use the `reserve` functionality
discussed [below](#reserving-capacity).

### Per-user rate limit:

Use `key` to use a rate limit specific to some user / team / session ID / etc.

```ts
const status = await rateLimiter.limit(ctx, "sendMessage", { key: userId });
```

### Consume a custom count

By default, each call to `limit` counts as one unit. Pass `count` to customize.

```ts
// Consume multiple in one request to prevent rate limits on an LLM API.
const status = await rateLimiter.limit(ctx, "llmTokens", { count: tokens });
```

### Throw automatically

By default it will return `{ ok, retryAfter }`. To have it throw automatically
when the limit is exceeded, use `throws`. It throws a `ConvexError` with
`RateLimitError` data (`data: {kind, name, retryAfter}`) instead of returning
when `ok` is false.

```ts
// Automatically throw an error if the rate limit is hit
await rateLimiter.limit(ctx, "failedLogins", { key: userId, throws: true });
```

### Check a rate limit without consuming it

```ts
const status = await rateLimiter.check(ctx, "failedLogins", { key: userId });
```

### Reset a rate limit

```ts
// Reset a rate limit on successful login
await rateLimiter.reset(ctx, "failedLogins", { key: userId });
```

### Define a rate limit inline / dynamically

```ts
// Use a one-off rate limit config (when not named on initialization)
const config = { kind: "fixed window", rate: 1, period: SECOND };
const status = await rateLimiter.limit(ctx, "oneOffName", { config });
```

### Using the React hook

You can use the React hook to check the rate limit in your browser code.

First, define the server API to get the rate limit value:

```ts
// In convex/example.ts
export const { getRateLimit, getServerTime } = rateLimiter.hookAPI(
  "sendMessage",
  {
    // Optionally provide a key function to get the key for the rate limit
    key: async (ctx) => await getUserId(ctx),
    // To allow the client to provide the key, pass a function that takes the key from the client
    key: async (ctx, keyFromClient) => {
      await ensureUserCanUseKey(ctx, keyFromClient);
      return keyFromClient;
    },
  },
);
```

Then, use the React hook to check the rate limit:

```ts
function App() {
  const { status: { ok, retryAt }, check } = useRateLimit(api.example.getRateLimit, {
    // [recommended] Allows the hook to sync the browser and server clocks
    getServerTimeMutation: getServerTime,
    // [optional] The number of tokens to wait on
    count: 1,
  });

  // If you want to check at specific times and get the concrete value:
  const { value, ts, config, ok, retryAt } = check(Date.now(), count);
```

### Fetching the current value directly

You can fetch the current value of a rate limit directly, if you want to know
the concrete value and timestamp it was last updated.

```ts
const { config, value, ts } = await rateLimiter.getValue(ctx, "sendMessage", {
  key: userId,
});
```

And you can use `calculateRateLimit` to calculate the value at a given
timestamp:

```ts
import { calculateRateLimit } from "@convex-dev/rate-limiter";

const { config, value, ts } = calculateRateLimit(
  { value, ts },
  config,
  Date.now(),
  count || 0,
);
```

### Scaling rate limiting with shards

When many requests are happening at once, they can all be trying to modify the
same values in the database. Because Convex provides strong transactions, they
will never overwrite each other, so you don't have to worry about the rate
limiter succeeding more often than it should. However, when there is high
contention for these values, it causes
[optimistic concurrency control conflicts](https://stack.convex.dev/how-convex-works#read-and-write-sets).
Convex automatically retries these a number of times with backoff, but it's
still best to avoid them.

Not to worry! To provide high throughput, we can use a technique called
"sharding" where we break up the total capacity into individual buckets, or
"shards". When we go to use some of that capacity, we check a random
shard.<sup>[1](#power-of-two)</sup> While sometimes we'll get unlucky and get
rate limited when there was capacity elsewhere, we'll never voilate the rate
limit's upper bound.

```ts
const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Use sharding to increase throughput without compromising on correctness.
  llmTokens: { kind: "token bucket", rate: 40000, period: MINUTE, shards: 10 },
  llmRequests: { kind: "fixed window", rate: 1000, period: MINUTE, shards: 10 },
});
```

Here we're using 10 shards to handle 1,000 QPM. If you want some rough math to
guess at how many shards to add, take the max queries per second you expect and
divide by two. It's also useful for each shard to have five (ideally ten) or
more capacity. In this case, we have ten (rate / shards) and don't expect normal
traffic to exceed ~20 QPS.

**Tip**: If you want a rate like `{ rate: 100, period: SECOND }` and you are
flexible in the overall period, then you can shard this by increasing the rate
and period proportionally to get enough shards and capacity per shard:
`{ shards: 50, rate: 250, period: 2.5 * SECOND }` or even better:
`{ shards: 50, rate: 1000, period: 10 * SECOND }`.

#### Power of two

We're actually going one step further and checking two shards and using the one
with more capacity, to keep them relatively balanced, based on the
[power of two technique](https://www.eecs.harvard.edu/~michaelm/postscripts/tpds2001.pdf).
We will also combine the capacity of the two shards if neither has enough on
their own.

### Scaling past sharding with async consumption

Sharding raises the ceiling but doesn't remove it: every request still updates a
shard document synchronously, and requests that pick the same shard contend.
Pass `async: true` and the request stops touching the limit at all:

```ts
const status = await rateLimiter.limit(ctx, "llmTokens", {
  count: tokens,
  async: true,
});
```

It still writes — it appends one row to a queue — but that's an insert of a new
document rather than an update of a hot one, so concurrent callers have nothing
to contend over. The read side is conflict-free too: the limit is read from a
recent database snapshot, which takes no read dependency on it. A
[batch worker](https://github.com/get-convex/batch-worker) folds the queue into
the limit in batches, summing everything for one limit into a single write. It
runs one loop at a time, so those documents have exactly one writer no matter
how fast requests arrive.

Reads of the limit need `stale: true` to match, which adds in the consumption
that's queued but not yet applied:

```ts
const status = await rateLimiter.check(ctx, "llmTokens", { stale: true });
const { value } = await rateLimiter.getValue(ctx, "llmTokens", { stale: true });
export const { getRateLimit } = rateLimiter.hookAPI("llmTokens", {
  stale: true,
});
```

From a mutation, `stale` also means the check takes no read dependency on the
limit, so checking one can't make the transaction conflict.

#### Use it consistently, per limit

**These flags are per call, and nothing enforces that you use them
consistently.** That's the one thing you have to get right yourself. A
synchronous call doesn't see queued consumption and writes the same document the
worker does, so mixing the two on one limit both over-admits and reintroduces
the conflicts you were avoiding — likewise a `check` without `stale` will wave
through a burst that has already used the limit up. Pick a mode per limit and
use it everywhere.

Sharding is redundant once you're async — the worker is the limit's only writer,
and it only ever writes the singleton shard — so the two can't be combined, and
for a limit defined on the client the types say so:

```ts
const rateLimiter = new RateLimiter(components.rateLimiter, {
  llmRequests: { kind: "fixed window", rate: 1000, period: MINUTE, shards: 10 },
});

// Type error: `async` is not available on a sharded limit.
await rateLimiter.limit(ctx, "llmRequests", { async: true });
```

With an inline `config` there's no named limit to check against, so that one
throws at runtime instead.

#### What you give up

An asynchronously-consumed limit is eventually consistent, so it can admit
slightly more than its rate for a moment:

- Requests that commit within the same instant can't see each other's
  consumption, so a truly simultaneous burst can overshoot. The debt is real —
  the value goes negative and requests are rejected until it's paid back — so
  the rate holds over any window longer than that instant.
- Several `limit` calls on the same limit _within one mutation_ all read the
  same snapshot, which doesn't include the calls before them. Consume once per
  mutation with a `count`, rather than calling it in a loop.
- A read walks at most 1024 queued updates for one limit. It normally stops far
  sooner — as soon as the queue passes what the limit could grant — so the bound
  only bites when a limit's capacity is larger than its queue is deep: many
  small consumptions against a big budget. Past it, a read under-counts and
  admits more than it should. Consuming once per mutation with a larger `count`
  keeps the queue short.
- A `stale` read accounts for the queue, so a subscribed `useRateLimit`
  recomputes as consumption is enqueued, not only as it's applied.

If you need a limit that can never be exceeded, even briefly, leave `async` off
and use shards instead.

### Reserving capacity:

You can also allow it to `reserve` capacity to avoid starvation on larger
requests.

When you reserve capacity ahead of time, the contract is that you can run your
operation at the specified time (via the `retryAfter` field), at which point you
don't have to re-check the rate limit. Your capacity has been "ear-marked".

With this, you can queue up many operations and they will be run at spaced-out
intervals, maximizing the utilization of the rate limit.

Details in the [Stack post](https://stack.convex.dev/rate-limiting).

```ts
const myAction = internalAction({
  args: {
    //...
    skipCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.skipCheck) {
      // Reserve future capacity instead of just failing now
      const status = await rateLimiter.limit(ctx, "llmRequests", {
        reserve: true,
      });
      if (status.retryAfter) {
        return ctx.scheduler.runAfter(
          status.retryAfter,
          internal.foo.myAction,
          {
            // When we run in the future, we can skip the rate limit check,
            // since we've just reserved that capacity.
            skipCheck: true,
          },
        );
      }
    }
    // do the operation
  },
});
```

### Adding jitter

When too many users show up at once, it can cause network congestion, database
contention, and consume other shared resources at an unnecessarily high rate.
Instead we can return a random time within the next period to retry. Hopefully
this is infrequent. This technique is referred to as adding "jitter."

A simple implementation could look like:

```ts
const retryAfter = status.retryAfter + Math.random() * period;
```

For the fixed window, we also introduce randomness by picking the start time of
the window (from which all subsequent windows are based) randomly if
config.start wasn't provided. This helps from all clients flooding requests at
midnight and paging you.

## More resources

[Check out a full example here](./example/convex/example.ts).

See [this article](https://stack.convex.dev/rate-limiting) for more information
on usage and advanced patterns, for example:

- How the different rate limiting strategies work under the hood.
- Using multiple rate limits in a single transaction.
- Rate limiting anonymous users.

<!-- END: Include on https://convex.dev/components -->

import { defineComponent } from "convex/server";
import batchWorker from "@convex-dev/batch-worker/convex.config.js";

const component = defineComponent("rateLimiter");
// Used by the batched (lazily-evaluated) rate limiting API to drain queued
// consumption and apply it to the rate limits on a single background loop.
component.use(batchWorker);

export default component;

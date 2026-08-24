import { defineComponent } from "convex/server";
import batchWorker from "@convex-dev/batch-worker/convex.config.js";

const component = defineComponent("rateLimiter");
// Drives the loop that folds `pendingUpdates` into `rateLimits` for lazy limits.
component.use(batchWorker);

export default component;

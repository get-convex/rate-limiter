import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { configValidator } from "../shared.js";

export default defineSchema({
  rateLimits: defineTable({
    name: v.string(),
    key: v.optional(v.string()), // undefined is singleton
    shard: v.number(), // 0 is singleton
    value: v.number(), // can go negative if capacity is reserved ahead of time
    ts: v.number(),
  }).index("name", ["name", "key", "shard"]),

  // Queue of consumption to apply for the batched (lazily-evaluated) API.
  // The thick client checks the current value with a snapshot query, then
  // appends a row here with a cheap insert-only mutation (no reads, so it never
  // OCC-conflicts with the worker). A single batch-worker loop drains these and
  // applies them to `rateLimits`, so there is exactly one writer per limit.
  consumption: defineTable({
    name: v.string(),
    key: v.optional(v.string()),
    shard: v.number(),
    count: v.number(),
    config: configValidator,
  }),
});

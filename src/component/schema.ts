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

  // Consumption of lazy rate limits, waiting to be folded into `rateLimits` by
  // the batch worker. Inserting here is contention-free, and reads of a lazy
  // limit subtract whatever is still queued.
  pendingUpdates: defineTable({
    name: v.string(),
    key: v.optional(v.string()), // undefined is singleton
    count: v.number(), // tokens to consume
    config: configValidator, // what to replenish at when the worker applies it
    // Resolves at commit to an int64 in commit order, which is what makes it
    // safe as the worker's cursor. Not `_creationTime`: that is assigned when
    // the mutation *starts*, so a slow mutation's row can land behind rows the
    // worker has already scanned past.
    updatedAt: v.commitTs(),
  })
    // The worker scans every limit's updates in commit order.
    .index("updatedAt", ["updatedAt"])
    // Reads of one limit sum only its own queued updates.
    .index("name_key_updatedAt", ["name", "key", "updatedAt"]),
});

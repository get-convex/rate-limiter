import { mutation } from "./_generated/server.js";
import { v } from "convex/values";

/**
 * A simple mutation that returns the current server time.
 * This is used by the useRateLimit hook to calculate clock skew.
 * 
 * @returns The current server time (Date.now())
 */
export const getServerTime = mutation({
  args: {},
  returns: v.number(),
  handler: async (): Promise<number> => {
    return Date.now();
  },
});

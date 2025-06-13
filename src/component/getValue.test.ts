import { convexTest } from "convex-test";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
import { api } from "./_generated/api.js";
import type { RateLimitConfig } from "../shared.js";

const Second = 1_000;

describe.each(["token bucket", "fixed window"] as const)(
  "getValue %s",
  (kind) => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("get value for unused rate limit", async () => {
      const t = convexTest(schema, modules);
      const name = "unused";
      const config = { kind, rate: 10, period: Second };

      await t.run(async (ctx) => {
        const result = await ctx.runQuery(api.lib.getValue, {
          name,
          config,
        });

        expect(result.value).toBe(10);
        expect(result.ts).toBeDefined();
        expect(result.config).toEqual(config);

        if (kind === "fixed window") {
          expect(result.windowStart).toBeDefined();
        } else {
          expect(result.windowStart).toBeUndefined();
        }
      });
    });

    test("get value with sampleShards parameter", async () => {
      const t = convexTest(schema, modules);
      const name = "sharded";
      const config = { kind, rate: 10, period: Second, shards: 5 };

      await t.run(async (ctx) => {
        const result = await ctx.runQuery(api.lib.getValue, {
          name,
          config,
          sampleShards: 3,
        });

        expect(result.value).toBe(10);
        expect(result.ts).toBeDefined();
        expect(result.config).toEqual(config);
      });
    });

    test("get value after consumption", async () => {
      const t = convexTest(schema, modules);
      const name = "consumed";
      const config = { kind, rate: 10, period: Second };

      await t.run(async (ctx) => {
        await ctx.runMutation(api.lib.rateLimit, {
          name,
          config,
          count: 4,
        });

        const result = await ctx.runQuery(api.lib.getValue, {
          name,
          config,
        });

        expect(result.value).toBe(6);
        expect(result.ts).toBeDefined();
        expect(result.config).toEqual(config);
      });
    });
  }
);

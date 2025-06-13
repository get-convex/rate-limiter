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
        expect(result.config).toMatchObject({
          ...config,
          capacity: config.rate,
          shards: 1,
        });

        if (kind === "fixed window") {
          assert(result.config.kind === "fixed window");
          expect(result.config.start).toBeDefined();
        } else {
          expect(result.config).toMatchObject({
            kind: "token bucket",
          });
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
        const { start, ...rest } = result.config;
        if (kind === "fixed window") {
          expect(start).toBeTypeOf("number");
        } else {
          expect(start).toBeFalsy();
        }
        expect(rest).toMatchObject({
          ...config,
          capacity: config.rate,
        });
      });
    });

    test("get value after consumption", async () => {
      const t = convexTest(schema, modules);
      const name = "consumed";
      const config = { kind, rate: 10, period: Second } as RateLimitConfig;

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
        expect(result.config).toMatchObject({
          ...config,
          capacity: config.rate,
        });
      });
    });
  }
);

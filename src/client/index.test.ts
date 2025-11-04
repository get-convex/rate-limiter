import { expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { isRateLimitError, type RateLimitError } from "./index.js";
test("isRateLimitError", () => {
  expect(
    isRateLimitError(
      new ConvexError({
        kind: "RateLimited",
        name: "foo",
        retryAfter: 1,
      } as RateLimitError),
    ),
  ).toBe(true);
  expect(isRateLimitError(new ConvexError({ kind: "foo" }))).toBe(false);
});

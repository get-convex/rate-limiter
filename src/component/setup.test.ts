/// <reference types="vite/client" />
import { test } from "vitest";
export const modules = import.meta.glob("./**/*.*s");
import { convexTest } from "convex-test";
import batchWorker from "@convex-dev/batch-worker/test";
import schema from "./schema.js";

export function initConvexTest() {
  const t = convexTest(schema, modules);
  batchWorker.register(t);
  return t;
}

test("setup", () => {});

import { convexToJson, jsonToConvex, type Value } from "convex/values";
import { type FunctionReference, getFunctionAddress } from "convex/server";

declare const Convex: {
  asyncSyscall: (op: string, jsonArgs: string) => Promise<string>;
};

/**
 * Run a query without creating a read dependency. Concurrent writes to the
 * data the query reads will NOT cause the calling mutation to retry via OCC.
 *
 * Tradeoff: a concurrent transaction that hasn't yet committed at snapshot
 * time may insert data this query won't see. This is what lets the lazy
 * rate-limit path admit requests against a stale view without contending on
 * the rate limit rows that the background worker is busy updating.
 */
export async function runSnapshotQuery(
  query: FunctionReference<"query", "public" | "internal">,
  args: Record<string, Value | undefined>,
): Promise<Value> {
  const syscallArgs = {
    udfType: "snapshotQuery",
    args: convexToJson(args),
    ...getFunctionAddress(query),
  };
  const resultStr = await Convex.asyncSyscall(
    "1.0/runUdf",
    JSON.stringify(syscallArgs),
  );
  return jsonToConvex(JSON.parse(resultStr));
}

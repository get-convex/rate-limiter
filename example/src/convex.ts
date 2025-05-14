import { ConvexProvider, ConvexReactClient } from "convex/react";
import React from "react";

const CONVEX_URL = process.env.VITE_CONVEX_URL || "https://example-dev.convex.cloud";
export const convex = new ConvexReactClient(CONVEX_URL);

export function ConvexProviderWithAuth({ children }: { children: React.ReactNode }) {
  return React.createElement(
    ConvexProvider,
    { client: convex },
    children
  );
}

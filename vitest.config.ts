import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@bstock/client": path.resolve(import.meta.dirname, "packages/client/src/client.ts"),
      "@bstock/analytics": path.resolve(import.meta.dirname, "packages/analytics/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
  },
});

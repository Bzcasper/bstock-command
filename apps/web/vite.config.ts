import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@bstock/client": path.resolve(import.meta.dirname, "../../packages/client/src/client.ts"),
      "@bstock/analytics": path.resolve(import.meta.dirname, "../../packages/analytics/src/index.ts"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8788" } },
});

import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:2567",
        ws: true,
      },
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@ltm/protocol": "../../packages/protocol/src/index.ts",
    },
  },
});

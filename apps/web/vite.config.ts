import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    hmr: {
      overlay: false,
    },
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
      "@ltm/city-schema": "../../packages/city-schema/src/index.ts",
      "@ltm/engine": "../../packages/engine/src/index.ts",
    },
  },
});

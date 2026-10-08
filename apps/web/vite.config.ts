import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  optimizeDeps: {
    exclude: ["@ltm/engine", "@ltm/city-schema", "@ltm/protocol"],
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@ltm/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts"),
      "@ltm/city-schema": path.resolve(__dirname, "../../packages/city-schema/src/index.ts"),
      "@ltm/engine": path.resolve(__dirname, "../../packages/engine/src/index.ts"),
    },
  },
});

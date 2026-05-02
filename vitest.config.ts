import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: "server-only", replacement: path.resolve(__dirname, "./src/test-utils/server-only-stub.ts") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
});

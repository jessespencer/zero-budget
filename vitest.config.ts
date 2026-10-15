import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["__tests__/setup/vitest.setup.ts"],
    // .tsx included so component tests are picked up — see __tests__/tsconfig.json.
    include: ["__tests__/**/*.test.{ts,tsx}"],
  },
});

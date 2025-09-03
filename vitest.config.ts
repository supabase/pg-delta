import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 60_000,
    slowTestThreshold: 10_000,
    retry: 1,
  },
});

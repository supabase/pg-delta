import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 60_000,
    slowTestThreshold: 10_000,
    retry: 1,
    // Use single fork to ensure truly shared containers across all tests
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // This ensures all tests run in the same worker process
      },
    },
  },
});

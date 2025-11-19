import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    slowTestThreshold: 10_000,
    coverage: {
      // Also report coverage if some tests fail
      reportOnFailure: true,
      reporter: ["text", "lcov", "html"],
    },
    projects: [
      {
        extends: true,
        test: {
          // Unit tests - run with full parallelism for maximum speed
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
          pool: "threads", // Full parallelism for unit tests
        },
      },
      {
        extends: true,
        test: {
          // Integration tests - run with forks to share containers via ContainerManager
          name: "integration",
          globalSetup: ["./tests/global-setup.ts"],
          include: [
            "tests/integration/**/*.test.ts",
            "**/*.integration.test.ts",
          ],
          retry: process.env.CI ? 1 : 0,
          isolate: false, // Share ContainerManager singleton across workers
          sequence: {
            concurrent: true, // Run tests concurrently within each worker
          },
        },
      },
    ],
  },
});

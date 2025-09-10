import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 60_000,
    slowTestThreshold: 10_000,
    projects: [
      {
        extends: true,
        test: {
          // Unit tests - run with full parallelism for maximum speed
          name: "unit",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "tests/integration/**"],
          pool: "threads", // Full parallelism for unit tests
        },
      },
      {
        extends: true,
        test: {
          // Integration tests - run with single fork to share containers
          name: "integration",
          retry: 0,
          include: [
            "**/*.integration.test.ts",
            "tests/integration/**/*.test.ts",
          ],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true, // Share containers across integration tests
            },
          },
        },
      },
    ],
  },
});

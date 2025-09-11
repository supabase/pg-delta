import { defineConfig } from "vitest/config";

const testIntegrationsInclude = [
  "**/*.integration.test.ts",
  "tests/integration/**/*.test.ts",
];

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
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
          retry: process.env.CI ? 1 : 0,
          include: testIntegrationsInclude,
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true, // Share containers across integration tests
            },
          },
          sequence: {
            concurrent: true,
          },
        },
      },
    ],
  },
});

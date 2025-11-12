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
          // Integration tests - run with single fork to share containers
          name: "integration",
          globalSetup: ["./tests/global-setup.ts"],
          include: [
            "tests/integration/**/*.test.ts",
            "**/*.integration.test.ts",
          ],
          retry: process.env.CI ? 1 : 0,
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
      {
        extends: true,
        test: {
          // Unit tests - run with full parallelism for maximum speed
          name: "supabase",
          include: ["tests/supabase/supabase.test.ts"],
        },
      },
    ],
  },
});

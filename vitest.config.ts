import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/migra/global-setup.ts"],
    testTimeout: 60_000,
  },
});

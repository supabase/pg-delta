import postgres from "postgres";
import { test as baseTest } from "vitest";
import { postgresConfig } from "../src/main.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
} from "./constants.ts";
import { containerManager } from "./container-manager.js";
import { SupabasePostgreSqlContainer } from "./supabase-postgres.js";

/**
 * Default test utility using Alpine PostgreSQL containers with single container per version.
 * Uses CREATE/DROP DATABASE for isolation instead of creating new containers.
 * Fast and suitable for most tests.
 */
export function getTest(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { main: postgres.Sql; branch: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const { main, branch, cleanup } =
        await containerManager.getDatabasePair(postgresVersion);

      await use({ main, branch });

      await cleanup();
    },
  });
}

/**
 * Isolated test utility using Alpine PostgreSQL containers.
 * Creates fresh containers for each test, then removes them.
 * Slower but provides complete isolation.
 */
export function getTestIsolated(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { main: postgres.Sql; branch: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const { main, branch, cleanup } =
        await containerManager.getIsolatedContainers(postgresVersion);

      await use({ main, branch });

      await cleanup();
    },
  });
}

/**
 * Test utility using Supabase PostgreSQL containers with full isolation.
 * Same behavior as the original getTest function.
 * Use for tests that require Supabase-specific features.
 */
export function getTestWithSupabaseIsolated(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { main: postgres.Sql; branch: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`;
      const [containerMain, containerBranch] = await Promise.all([
        new SupabasePostgreSqlContainer(image).start(),
        new SupabasePostgreSqlContainer(image).start(),
      ]);
      const main = postgres(containerMain.getConnectionUri(), postgresConfig);
      const branch = postgres(
        containerBranch.getConnectionUri(),
        postgresConfig,
      );

      await use({ main, branch });

      await Promise.all([main.end(), branch.end()]);
      await Promise.all([containerMain.stop(), containerBranch.stop()]);
    },
  });
}

function pick(keys: string[]) {
  return (obj: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  };
}

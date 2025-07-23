import postgres from "postgres";
import { test as baseTest } from "vitest";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
} from "./constants.ts";
import { SupabasePostgreSqlContainer } from "./supabase-postgres.js";

export function getTest(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { a: postgres.Sql; b: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`;
      const [containerA, containerB] = await Promise.all([
        new SupabasePostgreSqlContainer(image).start(),
        new SupabasePostgreSqlContainer(image).start(),
      ]);
      const a = postgres(containerA.getConnectionUri());
      const b = postgres(containerB.getConnectionUri());

      await use({ a, b });

      await Promise.all([a.end(), b.end()]);
      await Promise.all([containerA.stop(), containerB.stop()]);
    },
  });
}

export function pick(keys: string[]) {
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

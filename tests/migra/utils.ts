import { readdir, readFile } from "node:fs/promises";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { test as baseTest } from "vitest";
import {
  POSTGRES_VERSION_TO_DOCKER_TAG,
  type PostgresVersion,
} from "./constants.ts";

export async function getFixtures() {
  // use TEST_MIGRA_FIXTURES to run specific tests, e.g. `TEST_MIGRA_FIXTURES=constraints,dependencies pnpm test`
  const folders = process.env.TEST_MIGRA_FIXTURES
    ? process.env.TEST_MIGRA_FIXTURES.split(",")
    : await readdir(new URL("./fixtures", import.meta.url));
  const files = [
    "a.sql",
    "b.sql",
    "additions.sql",
    "expected.sql",
    "expected2.sql",
  ];
  const fixtures = await Promise.all(
    folders.map(async (folder) => {
      const [a, b, additions, expected, expected2] = await Promise.all(
        files.map(async (file) => {
          const content = await readFile(
            new URL(`./fixtures/${folder}/${file}`, import.meta.url),
            "utf-8",
          );
          if (content === "") {
            return null;
          }
          return content;
        }),
      );
      if (!(a && b && expected)) {
        throw new Error(`Missing fixtures for ${folder}`);
      }
      return {
        folder,
        a,
        b,
        additions,
        expected,
        expected2,
      };
    }),
  );

  return fixtures;
}

export function getTest(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { a: postgres.Sql; b: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const [containerA, containerB] = await Promise.all([
        new PostgreSqlContainer(
          `supabase/postgres:${POSTGRES_VERSION_TO_DOCKER_TAG[postgresVersion]}`,
        ).start(),
        new PostgreSqlContainer(
          `supabase/postgres:${POSTGRES_VERSION_TO_DOCKER_TAG[postgresVersion]}`,
        ).start(),
      ]);
      const a = postgres(containerA.getConnectionUri());
      const b = postgres(containerB.getConnectionUri());

      await use({ a, b });

      await Promise.all([a.end(), b.end()]);
      await Promise.all([containerA.stop(), containerB.stop()]);
    },
  });
}

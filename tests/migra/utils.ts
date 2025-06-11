import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { test as baseTest } from "vitest";

export function getTest(postgresVersion: number) {
  return baseTest.extend<{
    db: { a: postgres.Sql; b: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const [containerA, containerB] = await Promise.all([
        new PostgreSqlContainer(`postgres:${postgresVersion}-alpine`).start(),
        new PostgreSqlContainer(`postgres:${postgresVersion}-alpine`).start(),
      ]);
      const a = postgres(containerA.getConnectionUri());
      const b = postgres(containerB.getConnectionUri());

      await use({ a, b });

      await Promise.all([a.end(), b.end()]);
      await Promise.all([containerA.stop(), containerB.stop()]);
    },
  });
}

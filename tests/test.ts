import { PGlite } from "@electric-sql/pglite";
import { test as baseTest } from "vitest";

export const test = baseTest.extend<{ db: { source: PGlite; target: PGlite } }>(
  {
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const [source, target] = await Promise.all([
        PGlite.create(),
        PGlite.create(),
      ]);

      await use({ source, target });

      await Promise.all([source.close(), target.close()]);
    },
  },
);

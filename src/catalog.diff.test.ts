import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../tests/constants.ts";
import { getTest } from "../tests/utils.ts";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`catalog diff (pg${pgVersion})`, () => {
    test("create schema then composite type", async ({ db }) => {
      await db.b.unsafe(`
        create schema test_schema;
        create type test_schema.address as (
          street varchar,
          city varchar,
          state varchar
        );
      `);
      const mainCatalog = await extractCatalog(db.a);
      const branchCatalog = await extractCatalog(db.b);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);
      // Expect the changes to be:
      expect(changes).toHaveLength(2);
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "create",
            schema: expect.objectContaining({
              schema: "test_schema",
              owner: "supabase_admin",
            }),
          }),
          expect.objectContaining({
            kind: "create",
            type: expect.objectContaining({
              name: "_address",
              schema: "test_schema",
              owner: "supabase_admin",
            }),
          }),
        ]),
      );
    });
  });
}

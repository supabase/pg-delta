import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest, pick } from "../../../tests/utils.ts";
import { inspectSchemas } from "./schemas.ts";

describe.concurrent("inspect schemas", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of schemas`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create schema test_schema;
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public", "test_schema"]);
        const [resultA, resultB] = await Promise.all([
          inspectSchemas(db.a).then(filterResult),
          inspectSchemas(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          public: {
            owner: "pg_database_owner",
            schema: "public",
            dependent_on: [],
            dependents: [],
          },
          test_schema: {
            owner: "supabase_admin",
            schema: "test_schema",
            dependent_on: [],
            dependents: [],
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});

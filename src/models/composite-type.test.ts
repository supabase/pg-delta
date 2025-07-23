import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../tests/constants.ts";
import { getTest, pick } from "../../tests/utils.ts";
import { extractCompositeTypes } from "./composite-type.ts";

describe.concurrent("model CompositeType", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test("should extract stable properties of composite types", async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
          create type user_status as enum ('active', 'inactive', 'pending');
          create type test_composite as (
            id integer,
            name varchar(100),
            status user_status,
            created_at timestamp with time zone,
            is_active boolean
          );
        `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);

        // act
        const [resultA, resultB] = await Promise.all([
          extractCompositeTypes(db.a),
          extractCompositeTypes(db.b),
        ]);

        // Convert array to record keyed by "schema.name"
        const toRecord = (arr: any[]) =>
          Object.fromEntries(arr.map((ct) => [ct.stableId, ct]));

        const filterResult = pick(["compositeType:public.test_composite"]);
        const recordA = filterResult(toRecord(resultA));
        const recordB = filterResult(toRecord(resultB));

        // assert (check only model properties, not columns/deps)
        expect(recordA).toStrictEqual({
          "compositeType:public.test_composite": expect.objectContaining({
            schema: "public",
            name: "test_composite",
            force_row_security: false,
            has_indexes: false,
            has_rules: false,
            has_subclasses: false,
            has_triggers: false,
            is_partition: false,
            is_populated: true,
            options: null,
            owner: "supabase_admin",
            partition_bound: null,
            replica_identity: "n",
            row_security: false,
          }),
        });
        expect(recordB).toStrictEqual(recordA);
      });
    });
  }
});

import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectMaterializedViews } from "./materialized-views.ts";

describe.concurrent(
  "inspect materialized views",
  () => {
    const assertions = new Map([
      [
        "15",
        {
          definition: " SELECT mv_table.id\n   FROM mv_table;",
        },
      ],
      [
        "default",
        {
          definition: " SELECT id\n   FROM mv_table;",
        },
      ],
    ]);
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of materialized views`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table mv_table (id integer);
            create materialized view test_mv as select * from mv_table;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectMaterializedViews(db.a);
          const resultB = await inspectMaterializedViews(db.b);
          // assert
          const assertion =
            assertions.get(`${postgresVersion}`) === undefined
              ? assertions.get("default")
              : assertions.get(`${postgresVersion}`);
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_mv",
                {
                  definition: assertion?.definition,
                  force_row_security: false,
                  has_indexes: false,
                  has_rules: true,
                  has_subclasses: false,
                  has_triggers: false,
                  is_partition: false,
                  is_populated: true,
                  name: "test_mv",
                  options: null,
                  owner: "test",
                  partition_bound: null,
                  replica_identity: "d",
                  row_security: false,
                  schema: "public",
                },
              ],
            ]),
          );
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);

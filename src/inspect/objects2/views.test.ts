import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectViews } from "./views.ts";

describe.concurrent(
  "inspect views",
  () => {
    const assertions = new Map([
      [
        "15",
        {
          definition: " SELECT view_table.id\n   FROM view_table;",
        },
      ],
      [
        "default",
        {
          definition: " SELECT id\n   FROM view_table;",
        },
      ],
    ]);
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of views`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table view_table (id integer);
            create view test_view as select * from view_table;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectViews(db.a);
          const resultB = await inspectViews(db.b);
          // assert
          const assertion =
            assertions.get(`${postgresVersion}`) === undefined
              ? assertions.get("default")
              : assertions.get(`${postgresVersion}`);
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_view",
                {
                  definition: assertion?.definition,
                  force_row_security: false,
                  has_indexes: false,
                  has_rules: true,
                  has_subclasses: false,
                  has_triggers: false,
                  is_partition: false,
                  is_populated: true,
                  name: "test_view",
                  options: null,
                  owner: "test",
                  partition_bound: null,
                  replica_identity: "n",
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

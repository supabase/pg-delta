import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectViews } from "./views.ts";

describe.concurrent(
  "inspect views",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of views`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create type user_status as enum ('active', 'inactive', 'pending');
            create table view_table (
              id integer primary key,
              name varchar(100) not null,
              status user_status default 'active',
              created_at timestamp with time zone default now(),
              is_active boolean default true
            );
            create view test_view as select * from view_table;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectViews(db.a);
          const resultB = await inspectViews(db.b);
          // assert
          const expectedDefinition =
            postgresVersion === 15
              ? " SELECT view_table.id,\n    view_table.name,\n    view_table.status,\n    view_table.created_at,\n    view_table.is_active\n   FROM view_table;"
              : " SELECT id,\n    name,\n    status,\n    created_at,\n    is_active\n   FROM view_table;";

          expect(resultA).toEqual(
            new Map([
              [
                "public.test_view",
                {
                  definition: expectedDefinition,
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
                  columns: [
                    {
                      name: "id",
                      position: 1,
                      data_type: "integer",
                      data_type_str: "integer",
                      is_enum: false,
                      enum_schema: null,
                      enum_name: null,
                      not_null: false,
                      is_identity: false,
                      is_identity_always: false,
                      is_generated: false,
                      collation: null,
                      default: null,
                      comment: null,
                      dependent_on: [],
                      dependents: [],
                    },
                    {
                      name: "name",
                      position: 2,
                      data_type: "character varying",
                      data_type_str: "character varying(100)",
                      is_enum: false,
                      enum_schema: null,
                      enum_name: null,
                      not_null: false,
                      is_identity: false,
                      is_identity_always: false,
                      is_generated: false,
                      collation: null,
                      default: null,
                      comment: null,
                      dependent_on: [],
                      dependents: [],
                    },
                    {
                      name: "status",
                      position: 3,
                      data_type: "user_status",
                      data_type_str: "user_status",
                      is_enum: true,
                      enum_schema: "public",
                      enum_name: "user_status",
                      not_null: false,
                      is_identity: false,
                      is_identity_always: false,
                      is_generated: false,
                      collation: null,
                      default: null,
                      comment: null,
                      dependent_on: [],
                      dependents: [],
                    },
                    {
                      name: "created_at",
                      position: 4,
                      data_type: "timestamp with time zone",
                      data_type_str: "timestamp with time zone",
                      is_enum: false,
                      enum_schema: null,
                      enum_name: null,
                      not_null: false,
                      is_identity: false,
                      is_identity_always: false,
                      is_generated: false,
                      collation: null,
                      default: null,
                      comment: null,
                      dependent_on: [],
                      dependents: [],
                    },
                    {
                      name: "is_active",
                      position: 5,
                      data_type: "boolean",
                      data_type_str: "boolean",
                      is_enum: false,
                      enum_schema: null,
                      enum_name: null,
                      not_null: false,
                      is_identity: false,
                      is_identity_always: false,
                      is_generated: false,
                      collation: null,
                      default: null,
                      comment: null,
                      dependent_on: [],
                      dependents: [],
                    },
                  ],
                  dependent_on: [],
                  dependents: [],
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

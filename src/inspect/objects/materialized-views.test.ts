import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest, pick } from "../../../tests/utils.ts";
import { inspectMaterializedViews } from "./materialized-views.ts";

describe.concurrent("inspect materialized views", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of materialized views`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create type user_status as enum ('active', 'inactive', 'pending');
            create table mv_table (
              id integer primary key,
              name varchar(100) not null,
              status user_status default 'active',
              created_at timestamp with time zone default now(),
              is_active boolean default true
            );
            create materialized view test_mv as select * from mv_table;
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public.test_mv"]);
        const [resultA, resultB] = await Promise.all([
          inspectMaterializedViews(db.a).then(filterResult),
          inspectMaterializedViews(db.b).then(filterResult),
        ]);
        // assert
        const expectedDefinition =
          postgresVersion === 15
            ? // In postgres 15, columns are prefixed with the table name automatically in definition
              " SELECT mv_table.id,\n    mv_table.name,\n    mv_table.status,\n    mv_table.created_at,\n    mv_table.is_active\n   FROM mv_table;"
            : " SELECT id,\n    name,\n    status,\n    created_at,\n    is_active\n   FROM mv_table;";
        expect(resultA).toStrictEqual({
          "public.test_mv": {
            definition: expectedDefinition,
            force_row_security: false,
            has_indexes: false,
            has_rules: true,
            has_subclasses: false,
            has_triggers: false,
            is_partition: false,
            is_populated: true,
            name: "test_mv",
            options: null,
            owner: "supabase_admin",
            partition_bound: null,
            replica_identity: "d",
            row_security: false,
            schema: "public",
            columns: [
              {
                name: "id",
                position: 1,
                data_type: "integer",
                data_type_str: "integer",
                is_enum: false,
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
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
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
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
                is_custom_type: true,
                custom_type_schema: "public",
                custom_type_name: "user_status",
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
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
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
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
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
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});

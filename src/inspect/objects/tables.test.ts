import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectTables } from "./tables.ts";

describe.concurrent("inspect tables", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of tables`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create type user_status as enum ('active', 'inactive', 'pending');
            create table test_table (
              id integer primary key,
              name varchar(100) not null,
              email text unique,
              status user_status default 'active',
              created_at timestamp with time zone default now(),
              is_active boolean default true
            );
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public.test_table"]);
        const [resultA, resultB] = await Promise.all([
          inspectTables(db.a).then(filterResult),
          inspectTables(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toEqual({
          "public.test_table": {
            force_row_security: false,
            has_indexes: true,
            has_rules: false,
            has_subclasses: false,
            has_triggers: false,
            is_partition: false,
            is_populated: true,
            name: "test_table",
            options: null,
            owner: "supabase_admin",
            partition_bound: null,
            persistence: "p",
            replica_identity: "d",
            row_security: false,
            schema: "public",
            parent_schema: null,
            parent_name: null,
            columns: [
              {
                name: "id",
                position: 1,
                data_type: "integer",
                data_type_str: "integer",
                is_enum: false,
                enum_schema: null,
                enum_name: null,
                not_null: true,
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
                not_null: true,
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
                name: "email",
                position: 3,
                data_type: "text",
                data_type_str: "text",
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
                position: 4,
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
                default: "'active'::user_status",
                comment: null,
                dependent_on: [],
                dependents: [],
              },
              {
                name: "created_at",
                position: 5,
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
                default: "now()",
                comment: null,
                dependent_on: [],
                dependents: [],
              },
              {
                name: "is_active",
                position: 6,
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
                default: "true",
                comment: null,
                dependent_on: [],
                dependents: [],
              },
            ],
            dependent_on: [],
            dependents: [],
          },
        });
        expect(resultB).toEqual(resultA);
      });
    });
  }
});

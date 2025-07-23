import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest, pick } from "../../../tests/utils.ts";
import { inspectCompositeTypes } from "./composite-types.ts";

describe.concurrent("inspect composite types", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of composite types`, async ({
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
        const filterResult = pick(["public.test_composite"]);
        const [resultA, resultB] = await Promise.all([
          inspectCompositeTypes(db.a).then(filterResult),
          inspectCompositeTypes(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          "public.test_composite": {
            force_row_security: false,
            has_indexes: false,
            has_rules: false,
            has_subclasses: false,
            has_triggers: false,
            is_partition: false,
            is_populated: true,
            name: "test_composite",
            options: null,
            owner: "supabase_admin",
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
                collation: null,
                comment: null,
                data_type: "character varying",
                data_type_str: "character varying(100)",
                default: null,
                dependent_on: [],
                dependents: [],
                is_enum: false,
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
                is_generated: false,
                is_identity: false,
                is_identity_always: false,
                name: "name",
                not_null: false,
                position: 2,
              },
              {
                collation: null,
                comment: null,
                data_type: "user_status",
                data_type_str: "user_status",
                default: null,
                dependent_on: [],
                dependents: [],
                is_enum: true,
                is_custom_type: true,
                custom_type_schema: "public",
                custom_type_name: "user_status",
                is_generated: false,
                is_identity: false,
                is_identity_always: false,
                name: "status",
                not_null: false,
                position: 3,
              },
              {
                collation: null,
                comment: null,
                data_type: "timestamp with time zone",
                data_type_str: "timestamp with time zone",
                default: null,
                dependent_on: [],
                dependents: [],
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
                is_enum: false,
                is_generated: false,
                is_identity: false,
                is_identity_always: false,
                name: "created_at",
                not_null: false,
                position: 4,
              },
              {
                collation: null,
                comment: null,
                data_type: "boolean",
                data_type_str: "boolean",
                default: null,
                dependent_on: [],
                dependents: [],
                is_custom_type: false,
                custom_type_schema: null,
                custom_type_name: null,
                is_enum: false,
                is_generated: false,
                is_identity: false,
                is_identity_always: false,
                name: "is_active",
                not_null: false,
                position: 5,
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

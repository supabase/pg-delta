import { describe, expect, test } from "vitest";
import { CompositeType } from "../composite-type.model.ts";
import { CreateCompositeType } from "./composite-type.create.ts";

describe("composite-type", () => {
  test("create", () => {
    const compositeType = new CompositeType({
      schema: "public",
      name: "test_type",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "test",
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
    });

    const change = new CreateCompositeType({
      compositeType,
    });

    expect(change.serialize()).toBe(
      "CREATE TYPE public.test_type AS (id integer)",
    );
  });

  test("create with collate", () => {
    const compositeType = new CompositeType({
      schema: "public",
      name: "test_type",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "test",
      columns: [
        {
          name: "name",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: '"en_US"',
          default: null,
          comment: null,
        },
      ],
    });

    const change = new CreateCompositeType({ compositeType });

    expect(change.serialize()).toBe(
      'CREATE TYPE public.test_type AS (name text COLLATE "en_US")',
    );
  });
});

import { describe, expect, test } from "vitest";
import { Table, type TableProps } from "../table.model.ts";
import { CreateTable } from "./table.create.ts";

const base: TableProps = {
  schema: "public",
  name: "t",
  persistence: "p",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: null,
  partition_bound: null,
  owner: "o1",
  parent_schema: null,
  parent_name: null,
  columns: [],
};

describe.concurrent("table.create", () => {
  test("minimal create with no columns", () => {
    const t = new Table(base);
    const change = new CreateTable({ table: t });
    expect(change.serialize()).toBe("CREATE TABLE public.t ()");
  });

  test("TEMPORARY with columns, inherits and options", () => {
    const t = new Table({
      ...base,
      persistence: "t",
      parent_schema: "public",
      parent_name: "parent",
      options: ["fillfactor=90", "autovacuum_enabled=true"],
      columns: [
        {
          name: "c1",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: "0",
          comment: null,
        },
        {
          name: "c2",
          position: 2,
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
          collation: "en_US",
          default: null,
          comment: null,
        },
        {
          name: "c3",
          position: 3,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: true,
          is_identity_always: true,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
        {
          name: "c4",
          position: 4,
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
          is_generated: true,
          collation: null,
          default: "lower((name))",
          comment: null,
        },
      ],
    });

    const change = new CreateTable({ table: t });
    expect(change.serialize()).toBe(
      'CREATE TEMPORARY TABLE public.t (c1 integer DEFAULT 0 NOT NULL, c2 text COLLATE "en_US", c3 integer GENERATED ALWAYS AS IDENTITY, c4 text GENERATED ALWAYS AS (lower((name))) STORED) INHERITS (public.parent) WITH (fillfactor=90, autovacuum_enabled=true)',
    );
  });
});

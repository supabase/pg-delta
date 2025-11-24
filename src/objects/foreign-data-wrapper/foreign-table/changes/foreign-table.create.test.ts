import { describe, expect, test } from "vitest";
import { ForeignTable } from "../foreign-table.model.ts";
import { CreateForeignTable } from "./foreign-table.create.ts";

describe("foreign-table", () => {
  test("create basic", () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: null,
      comment: null,
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
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer) SERVER test_server",
    );
  });

  test("create with multiple columns", () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: null,
      comment: null,
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
        {
          name: "name",
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
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer, name text) SERVER test_server",
    );
  });

  test("create with options", () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: ["schema_name", "remote_schema", "table_name", "remote_table"],
      comment: null,
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
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer) SERVER test_server OPTIONS (schema_name 'remote_schema', table_name 'remote_table')",
    );
  });

  test("create with all properties", () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: ["schema_name", "remote_schema", "table_name", "remote_table"],
      comment: null,
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
        {
          name: "name",
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
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer, name text) SERVER test_server OPTIONS (schema_name 'remote_schema', table_name 'remote_table')",
    );
  });
});

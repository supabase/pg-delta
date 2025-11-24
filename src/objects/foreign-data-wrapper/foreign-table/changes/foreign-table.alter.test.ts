import { describe, expect, test } from "vitest";
import {
  ForeignTable,
  type ForeignTableProps,
} from "../foreign-table.model.ts";
import {
  AlterForeignTableAddColumn,
  AlterForeignTableAlterColumnDropDefault,
  AlterForeignTableAlterColumnDropNotNull,
  AlterForeignTableAlterColumnSetDefault,
  AlterForeignTableAlterColumnSetNotNull,
  AlterForeignTableAlterColumnType,
  AlterForeignTableChangeOwner,
  AlterForeignTableDropColumn,
  AlterForeignTableSetOptions,
} from "./foreign-table.alter.ts";

describe.concurrent("foreign-table", () => {
  describe("alter", () => {
    const baseTableProps: ForeignTableProps = {
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
    };

    test("change owner", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableChangeOwner({
        foreignTable,
        owner: "new_owner",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OWNER TO new_owner",
      );
    });

    test("add column", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
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
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text",
      );
    });

    test("add column with NOT NULL", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
          name: "name",
          position: 2,
          data_type: "text",
          data_type_str: "text",
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
          default: null,
          comment: null,
        },
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text NOT NULL",
      );
    });

    test("add column with DEFAULT", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
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
          default: "'default_value'",
          comment: null,
        },
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text DEFAULT 'default_value'",
      );
    });

    test("add column with NOT NULL and DEFAULT", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
          name: "name",
          position: 2,
          data_type: "text",
          data_type_str: "text",
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
          default: "'default_value'",
          comment: null,
        },
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text NOT NULL DEFAULT 'default_value'",
      );
    });

    test("drop column", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableDropColumn({
        foreignTable,
        columnName: "id",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table DROP COLUMN id",
      );
    });

    test("alter column type", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnType({
        foreignTable,
        columnName: "id",
        dataType: "bigint",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id TYPE bigint",
      );
    });

    test("alter column set default", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnSetDefault({
        foreignTable,
        columnName: "id",
        defaultValue: "0",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id SET DEFAULT 0",
      );
    });

    test("alter column drop default", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnDropDefault({
        foreignTable,
        columnName: "id",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id DROP DEFAULT",
      );
    });

    test("alter column set not null", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnSetNotNull({
        foreignTable,
        columnName: "id",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id SET NOT NULL",
      );
    });

    test("alter column drop not null", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnDropNotNull({
        foreignTable,
        columnName: "id",
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id DROP NOT NULL",
      );
    });

    test("set options ADD", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [
          { action: "ADD", option: "schema_name", value: "remote_schema" },
          { action: "ADD", option: "table_name", value: "remote_table" },
        ],
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (ADD schema_name 'remote_schema', ADD table_name 'remote_table')",
      );
    });

    test("set options SET", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [
          { action: "SET", option: "schema_name", value: "new_schema" },
        ],
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (SET schema_name 'new_schema')",
      );
    });

    test("set options DROP", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [{ action: "DROP", option: "schema_name" }],
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (DROP schema_name)",
      );
    });

    test("set options mixed ADD/SET/DROP", () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [
          { action: "ADD", option: "new_option", value: "new_value" },
          { action: "SET", option: "existing_option", value: "updated_value" },
          { action: "DROP", option: "old_option" },
        ],
      });

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (ADD new_option 'new_value', SET existing_option 'updated_value', DROP old_option)",
      );
    });
  });
});

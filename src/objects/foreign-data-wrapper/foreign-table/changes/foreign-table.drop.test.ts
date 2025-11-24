import { describe, expect, test } from "vitest";
import { ForeignTable } from "../foreign-table.model.ts";
import { DropForeignTable } from "./foreign-table.drop.ts";

describe("foreign-table", () => {
  test("drop", () => {
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

    const change = new DropForeignTable({
      foreignTable,
    });

    expect(change.serialize()).toBe("DROP FOREIGN TABLE public.test_table");
  });
});

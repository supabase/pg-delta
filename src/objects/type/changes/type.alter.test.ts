import { describe, expect, test } from "vitest";
import { Type } from "../type.model.ts";
import { AlterTypeChangeOwner, ReplaceType } from "./type.alter.ts";

describe.concurrent("type", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Type({
        schema: "public",
        name: "test_type",
        type_type: "b",
        type_category: "U",
        is_preferred: false,
        is_defined: true,
        delimiter: ",",
        storage_length: -1,
        passed_by_value: false,
        alignment: "i",
        storage: "x",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        default_bin: null,
        default_value: null,
        owner: "old_owner",
      });
      const branch = new Type({
        schema: "public",
        name: "test_type",
        type_type: "b",
        type_category: "U",
        is_preferred: false,
        is_defined: true,
        delimiter: ",",
        storage_length: -1,
        passed_by_value: false,
        alignment: "i",
        storage: "x",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        default_bin: null,
        default_value: null,
        owner: "new_owner",
      });

      const change = new AlterTypeChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_type OWNER TO new_owner",
      );
    });

    test("replace type", () => {
      const main = new Type({
        schema: "public",
        name: "test_type",
        type_type: "b",
        type_category: "U",
        is_preferred: false,
        is_defined: true,
        delimiter: ",",
        storage_length: -1,
        passed_by_value: false,
        alignment: "i",
        storage: "x",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      });
      const branch = new Type({
        schema: "public",
        name: "test_type",
        type_type: "b",
        type_category: "U",
        is_preferred: false,
        is_defined: true,
        delimiter: ",",
        storage_length: -1,
        passed_by_value: false,
        alignment: "i",
        storage: "x",
        not_null: true,
        type_modifier: null,
        array_dimensions: null,
        default_bin: null,
        default_value: null,
        owner: "test",
      });

      const change = new ReplaceType({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP TYPE public.test_type;\nCREATE TYPE public.test_type",
      );
    });
  });
});

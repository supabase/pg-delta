import { describe, expect, test } from "vitest";
import { Type } from "../type.model.ts";
import { CreateType } from "./type.create.ts";

describe("type", () => {
  test("create", () => {
    const type = new Type({
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

    const change = new CreateType({
      type,
    });

    expect(change.serialize()).toBe(`CREATE TYPE public.test_type`);
  });
});

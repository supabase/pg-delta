import { describe, expect, test } from "vitest";
import { Range } from "../range.model.ts";
import { DropRange } from "./range.drop.ts";

describe("range", () => {
  test("drop", () => {
    const r = new Range({
      schema: "public",
      name: "tsrange_custom",
      owner: "owner1",
      subtype_schema: "pg_catalog",
      subtype_str: "int4",
      collation: null,
      canonical_function_schema: null,
      canonical_function_name: null,
      subtype_diff_schema: null,
      subtype_diff_name: null,
      subtype_opclass_schema: null,
      subtype_opclass_name: null,
      comment: null,
    });
    const change = new DropRange({ range: r });
    expect(change.serialize()).toBe("DROP TYPE public.tsrange_custom");
  });
});

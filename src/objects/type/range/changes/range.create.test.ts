import { describe, expect, test } from "vitest";
import { Range } from "../range.model.ts";
import { CreateRange } from "./range.create.ts";

describe("range", () => {
  test("create minimal", () => {
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
    });
    const change = new CreateRange({ range: r });
    expect(change.serialize()).toBe(
      "CREATE TYPE public.tsrange_custom AS RANGE (SUBTYPE = int4)",
    );
  });

  test("create with options", () => {
    const r = new Range({
      schema: "public",
      name: "daterange_custom",
      owner: "owner1",
      subtype_schema: "pg_catalog",
      subtype_str: "date",
      collation: '"en_US"',
      canonical_function_schema: "public",
      canonical_function_name: "canon_fn",
      subtype_diff_schema: "public",
      subtype_diff_name: "diff_fn",
      subtype_opclass_schema: "public",
      subtype_opclass_name: "date_ops",
    });
    const change = new CreateRange({ range: r });
    expect(change.serialize()).toBe(
      'CREATE TYPE public.daterange_custom AS RANGE (SUBTYPE = date, SUBTYPE_OPCLASS = public.date_ops, COLLATION = "en_US", CANONICAL = public.canon_fn, SUBTYPE_DIFF = public.diff_fn)',
    );
  });
});

import { describe, expect, test } from "vitest";
import { AlterRangeChangeOwner } from "./changes/range.alter.ts";
import { CreateRange } from "./changes/range.create.ts";
import { DropRange } from "./changes/range.drop.ts";
import { diffRanges } from "./range.diff.ts";
import { Range, type RangeProps } from "./range.model.ts";

const base: RangeProps = {
  schema: "public",
  name: "ts_custom",
  owner: "o1",
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
};

describe.concurrent("range.diff", () => {
  test("create and drop", () => {
    const r = new Range(base);
    const created = diffRanges({}, { [r.stableId]: r });
    expect(created[0]).toBeInstanceOf(CreateRange);
    const dropped = diffRanges({ [r.stableId]: r }, {});
    expect(dropped[0]).toBeInstanceOf(DropRange);
  });

  test("alter owner", () => {
    const main = new Range(base);
    const branch = new Range({ ...base, owner: "o2" });
    const changes = diffRanges(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRangeChangeOwner);
  });

  test("drop and create when non-alterable property changes", () => {
    const main = new Range(base);
    const branch = new Range({
      ...base,
      subtype_schema: "pg_catalog",
      subtype_str: "text",
      collation: "en_US",
    });
    const changes = diffRanges(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropRange);
    expect(changes[1]).toBeInstanceOf(CreateRange);
  });
});

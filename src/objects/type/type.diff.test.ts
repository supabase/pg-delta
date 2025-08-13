import { describe, expect, test } from "vitest";
import { AlterTypeChangeOwner, ReplaceType } from "./changes/type.alter.ts";
import { CreateType } from "./changes/type.create.ts";
import { DropType } from "./changes/type.drop.ts";
import { diffTypes } from "./type.diff.ts";
import { Type, type TypeProps } from "./type.model.ts";

const base: TypeProps = {
  schema: "public",
  name: "t1",
  type_type: "b",
  type_category: "N",
  is_preferred: false,
  is_defined: true,
  delimiter: ",",
  storage_length: 4,
  passed_by_value: true,
  alignment: "i",
  storage: "p",
  not_null: false,
  type_modifier: null,
  array_dimensions: null,
  default_bin: null,
  default_value: null,
  owner: "o1",
};

describe.concurrent("type.diff", () => {
  test("create and drop", () => {
    const t = new Type(base);
    const created = diffTypes({}, { [t.stableId]: t });
    expect(created[0]).toBeInstanceOf(CreateType);
    const dropped = diffTypes({ [t.stableId]: t }, {});
    expect(dropped[0]).toBeInstanceOf(DropType);
  });

  test("alter owner", () => {
    const main = new Type(base);
    const branch = new Type({ ...base, owner: "o2" });
    const changes = diffTypes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterTypeChangeOwner);
  });

  test("replace on non-alterable change", () => {
    const main = new Type(base);
    const branch = new Type({ ...base, type_type: "e" });
    const changes = diffTypes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceType);
  });
});

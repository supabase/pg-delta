import { describe, expect, test } from "vitest";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
  ReplaceEnum,
} from "./changes/enum.alter.ts";
import { CreateEnum } from "./changes/enum.create.ts";
import { DropEnum } from "./changes/enum.drop.ts";
import { diffEnums } from "./enum.diff.ts";
import { Enum, type EnumProps } from "./enum.model.ts";

describe.concurrent("enum.diff", () => {
  test("create and drop", () => {
    const props: EnumProps = {
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
      ],
    };
    const e = new Enum(props);

    const created = diffEnums({}, { [e.stableId]: e });
    expect(created[0]).toBeInstanceOf(CreateEnum);

    const dropped = diffEnums({ [e.stableId]: e }, {});
    expect(dropped[0]).toBeInstanceOf(DropEnum);
  });

  test("alter: owner change and add value positioning", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "c", sort_order: 3 },
      ],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o2",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
    });

    const changes = diffEnums(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterEnumChangeOwner)).toBe(true);
    const add = changes.find((c) => c instanceof AlterEnumAddValue) as
      | AlterEnumAddValue
      | undefined;
    expect(add).toBeDefined();
  });

  test("replace for complex label changes (removal)", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
      ],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
    });

    const changes = diffEnums(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof ReplaceEnum)).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import { Enum, type EnumProps } from "../enum.model.ts";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
  ReplaceEnum,
} from "./enum.alter.ts";

describe.concurrent("enum", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<EnumProps, "owner"> = {
        schema: "public",
        name: "test_enum",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
      };
      const main = new Enum({
        ...props,
        owner: "old_owner",
      });
      const branch = new Enum({
        ...props,
        owner: "new_owner",
      });

      const change = new AlterEnumChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum OWNER TO new_owner",
      );
    });

    test("add value", () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
      };
      const main = new Enum(props);
      const branch = new Enum({
        ...props,
        labels: [...props.labels, { sort_order: 3, label: "value3" }],
      });

      const change = new AlterEnumAddValue({
        main,
        branch,
        newValue: "value3",
      });

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum ADD VALUE 'value3'",
      );
    });

    test("add value before", () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
      };
      const main = new Enum(props);
      const branch = new Enum({
        ...props,
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 1.5, label: "value1_5" },
          { sort_order: 2, label: "value2" },
        ],
      });

      const change = new AlterEnumAddValue({
        main,
        branch,
        newValue: "value1_5",
        position: { before: "value2" },
      });

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum ADD VALUE 'value1_5' BEFORE 'value2'",
      );
    });

    test("add value after", () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
      };
      const main = new Enum(props);
      const branch = new Enum({
        ...props,
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 1.5, label: "value1_5" },
          { sort_order: 2, label: "value2" },
        ],
      });

      const change = new AlterEnumAddValue({
        main,
        branch,
        newValue: "value1_5",
        position: { after: "value1" },
      });

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum ADD VALUE 'value1_5' AFTER 'value1'",
      );
    });

    test("replace enum", () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
      };
      const main = new Enum(props);
      const branch = new Enum({
        ...props,
        labels: [...props.labels, { sort_order: 3, label: "value3" }],
      });

      const change = new ReplaceEnum({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP TYPE public.test_enum;\nCREATE TYPE public.test_enum AS ENUM ('value1', 'value2', 'value3')",
      );
    });
  });
});

import { describe, expect, test } from "vitest";
import { Enum } from "../enum.model.ts";
import { DropEnum } from "./enum.drop.ts";

describe("enum", () => {
  test("drop", () => {
    const enumType = new Enum({
      schema: "public",
      name: "test_enum",
      owner: "test",
      labels: [
        { sort_order: 1, label: "value1" },
        { sort_order: 2, label: "value2" },
      ],
      comment: null,
    });

    const change = new DropEnum({
      enum: enumType,
    });

    expect(change.serialize()).toBe("DROP TYPE public.test_enum");
  });
});

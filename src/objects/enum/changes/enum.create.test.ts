import { describe, expect, test } from "vitest";
import { Enum } from "../enum.model.ts";
import { CreateEnum } from "./enum.create.ts";

describe("enum", () => {
  test("create", () => {
    const enumType = new Enum({
      schema: "public",
      name: "test_enum",
      owner: "test",
      labels: [
        { sort_order: 1, label: "value1" },
        { sort_order: 2, label: "value2" },
        { sort_order: 3, label: "value3" },
      ],
    });

    const change = new CreateEnum({
      enum: enumType,
    });

    expect(change.serialize()).toBe(
      "CREATE TYPE public.test_enum AS ENUM (value1, value2, value3)",
    );
  });
});

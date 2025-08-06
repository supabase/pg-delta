import { describe, expect, test } from "vitest";
import { Schema } from "../schema.model.ts";
import { DropSchema } from "./schema.drop.ts";

describe("schema", () => {
  test("drop", () => {
    const schema = new Schema({
      schema: "test_schema",
      owner: "test",
    });

    const change = new DropSchema({
      schema,
    });

    expect(change.serialize()).toBe("DROP SCHEMA test_schema");
  });
});

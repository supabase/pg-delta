import { describe, expect, test } from "vitest";
import { Schema } from "../schema.model.ts";
import { CreateSchema } from "./schema.create.ts";

describe("schema", () => {
  test("create", () => {
    const schema = new Schema({
      schema: "test_schema",
      owner: "test",
    });

    const change = new CreateSchema({
      schema,
    });

    expect(change.serialize()).toBe("CREATE SCHEMA test_schema");
  });
});

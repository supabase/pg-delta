import { describe, expect, test } from "vitest";
import { Schema } from "../schema.model.ts";
import { AlterSchemaChangeOwner, ReplaceSchema } from "./schema.alter.ts";

describe.concurrent("schema", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Schema({
        schema: "test_schema",
        owner: "old_owner",
      });
      const branch = new Schema({
        schema: "test_schema",
        owner: "new_owner",
      });

      const change = new AlterSchemaChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER SCHEMA test_schema OWNER TO new_owner",
      );
    });

    test("replace schema", () => {
      const main = new Schema({
        schema: "test_schema",
        owner: "test",
      });
      const branch = new Schema({
        schema: "test_schema",
        owner: "test",
      });

      const change = new ReplaceSchema({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP SCHEMA test_schema;\nCREATE SCHEMA test_schema",
      );
    });
  });
});

import { describe, expect, test } from "vitest";
import { Schema, type SchemaProps } from "../schema.model.ts";
import { AlterSchemaChangeOwner, ReplaceSchema } from "./schema.alter.ts";

describe.concurrent("schema", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<SchemaProps, "owner"> = {
        schema: "test_schema",
      };
      const main = new Schema({
        ...props,
        owner: "old_owner",
      });
      const branch = new Schema({
        ...props,
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
      const props: SchemaProps = {
        schema: "test_schema",
        owner: "test",
      };
      const main = new Schema(props);
      const branch = new Schema(props);

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

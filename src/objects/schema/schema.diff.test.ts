import { describe, expect, test } from "vitest";
import {
  AlterSchemaChangeOwner,
  ReplaceSchema,
} from "./changes/schema.alter.ts";
import { CreateSchema } from "./changes/schema.create.ts";
import { DropSchema } from "./changes/schema.drop.ts";
import { diffSchemas } from "./schema.diff.ts";
import { Schema, type SchemaProps } from "./schema.model.ts";

const base: SchemaProps = {
  schema: "utils",
  owner: "o1",
};

describe.concurrent("schema.diff", () => {
  test("create and drop", () => {
    const s = new Schema(base);
    const created = diffSchemas({}, { [s.stableId]: s });
    expect(created[0]).toBeInstanceOf(CreateSchema);
    const dropped = diffSchemas({ [s.stableId]: s }, {});
    expect(dropped[0]).toBeInstanceOf(DropSchema);
  });

  test("alter owner", () => {
    const main = new Schema(base);
    const branch = new Schema({ ...base, owner: "o2" });
    const changes = diffSchemas(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterSchemaChangeOwner);
  });

  test("replace when non-alterable changes (none currently) yields no replace", () => {
    const main = new Schema(base);
    const branch = new Schema({ ...base, owner: "o2" });
    const changes = diffSchemas(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof ReplaceSchema)).toBe(false);
  });
});

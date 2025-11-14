import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import { AlterSchemaChangeOwner } from "./changes/schema.alter.ts";
import { CreateSchema } from "./changes/schema.create.ts";
import { DropSchema } from "./changes/schema.drop.ts";
import { diffSchemas } from "./schema.diff.ts";
import { Schema, type SchemaProps } from "./schema.model.ts";

const base: SchemaProps = {
  name: "utils",
  owner: "o1",
  comment: null,
  privileges: [],
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
};

describe.concurrent("schema.diff", () => {
  test("create and drop", () => {
    const s = new Schema(base);
    const created = diffSchemas(testContext, {}, { [s.stableId]: s });
    expect(created[0]).toBeInstanceOf(CreateSchema);
    const dropped = diffSchemas(testContext, { [s.stableId]: s }, {});
    expect(dropped[0]).toBeInstanceOf(DropSchema);
  });

  test("alter owner", () => {
    const main = new Schema(base);
    const branch = new Schema({ ...base, owner: "o2" });
    const changes = diffSchemas(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterSchemaChangeOwner);
  });
});

import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import {
  AlterCompositeTypeAddAttribute,
  AlterCompositeTypeAlterAttributeType,
  AlterCompositeTypeChangeOwner,
  AlterCompositeTypeDropAttribute,
} from "./changes/composite-type.alter.ts";
import { CreateCompositeType } from "./changes/composite-type.create.ts";
import { DropCompositeType } from "./changes/composite-type.drop.ts";
import { diffCompositeTypes } from "./composite-type.diff.ts";
import {
  CompositeType,
  type CompositeTypeProps,
} from "./composite-type.model.ts";

const base: CompositeTypeProps = {
  schema: "public",
  name: "ct",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: null,
  partition_bound: null,
  owner: "o1",
  comment: null,
  columns: [],
  privileges: [],
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
};

describe.concurrent("composite-type.diff", () => {
  test("create and drop", () => {
    const ct = new CompositeType(base);
    const created = diffCompositeTypes(testContext, {}, { [ct.stableId]: ct });
    expect(created[0]).toBeInstanceOf(CreateCompositeType);
    const dropped = diffCompositeTypes(testContext, { [ct.stableId]: ct }, {});
    expect(dropped[0]).toBeInstanceOf(DropCompositeType);
  });

  test("alter owner", () => {
    const main = new CompositeType(base);
    const branch = new CompositeType({ ...base, owner: "o2" });
    const changes = diffCompositeTypes(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterCompositeTypeChangeOwner);
  });

  test("add attribute", () => {
    const main = new CompositeType(base);
    const branch = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });
    const changes = diffCompositeTypes(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterCompositeTypeAddAttribute),
    ).toBe(true);
  });

  test("drop attribute", () => {
    const main = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
    });
    const branch = new CompositeType(base);
    const changes = diffCompositeTypes(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterCompositeTypeDropAttribute),
    ).toBe(true);
  });

  test("alter attribute type/collation", () => {
    const main = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
    });
    const branch = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: "en_US",
          default: null,
          comment: null,
        },
      ],
    });
    const changes = diffCompositeTypes(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterCompositeTypeAlterAttributeType),
    ).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import {
  AlterForeignTableAddColumn,
  AlterForeignTableAlterColumnDropDefault,
  AlterForeignTableAlterColumnDropNotNull,
  AlterForeignTableAlterColumnSetDefault,
  AlterForeignTableAlterColumnSetNotNull,
  AlterForeignTableAlterColumnType,
  AlterForeignTableChangeOwner,
  AlterForeignTableDropColumn,
  AlterForeignTableSetOptions,
} from "./changes/foreign-table.alter.ts";
import { CreateForeignTable } from "./changes/foreign-table.create.ts";
import { DropForeignTable } from "./changes/foreign-table.drop.ts";
import { diffForeignTables } from "./foreign-table.diff.ts";
import { ForeignTable, type ForeignTableProps } from "./foreign-table.model.ts";

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("foreign-table.diff", () => {
  test("create and drop", () => {
    const props: ForeignTableProps = {
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    };
    const table = new ForeignTable(props);

    const created = diffForeignTables(
      testContext,
      {},
      {
        [table.stableId]: table,
      },
    );
    expect(created[0]).toBeInstanceOf(CreateForeignTable);

    const dropped = diffForeignTables(
      testContext,
      { [table.stableId]: table },
      {},
    );
    expect(dropped[0]).toBeInstanceOf(DropForeignTable);
  });

  test("alter: owner change", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o2",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterForeignTableChangeOwner)).toBe(
      true,
    );
  });

  test("alter: add column", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
        {
          name: "name",
          position: 2,
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterForeignTableAddColumn)).toBe(
      true,
    );
  });

  test("alter: drop column", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
        {
          name: "name",
          position: 2,
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterForeignTableDropColumn)).toBe(
      true,
    );
  });

  test("alter: column type change", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "bigint",
          data_type_str: "bigint",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterForeignTableAlterColumnType),
    ).toBe(true);
  });

  test("alter: column set default", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
          default: "0",
          comment: null,
        },
      ],
      privileges: [],
    });

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterForeignTableAlterColumnSetDefault),
    ).toBe(true);
  });

  test("alter: column drop default", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
          default: "0",
          comment: null,
        },
      ],
      privileges: [],
    });
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterForeignTableAlterColumnDropDefault),
    ).toBe(true);
  });

  test("alter: column set not null", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterForeignTableAlterColumnSetNotNull),
    ).toBe(true);
  });

  test("alter: column drop not null", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterForeignTableAlterColumnDropNotNull),
    ).toBe(true);
  });

  test("alter: options changes", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: ["schema_name", "remote_schema"],
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: ["schema_name", "new_schema", "table_name", "remote_table"],
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const optionsChange = changes.find(
      (c) => c instanceof AlterForeignTableSetOptions,
    ) as AlterForeignTableSetOptions | undefined;
    expect(optionsChange).toBeDefined();
    expect(optionsChange?.options.length).toBeGreaterThan(0);
  });

  test("server change triggers drop and create", () => {
    const main = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv1",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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
    const branch = new ForeignTable({
      schema: "public",
      name: "ft1",
      owner: "o1",
      server: "srv2",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
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

    const changes = diffForeignTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    // Server change should trigger drop + create
    expect(changes.some((c) => c instanceof DropForeignTable)).toBe(true);
    expect(changes.some((c) => c instanceof CreateForeignTable)).toBe(true);
  });
});

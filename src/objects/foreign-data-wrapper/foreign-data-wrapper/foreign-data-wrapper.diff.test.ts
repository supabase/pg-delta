import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import {
  AlterForeignDataWrapperChangeOwner,
  AlterForeignDataWrapperSetOptions,
} from "./changes/foreign-data-wrapper.alter.ts";
import { CreateForeignDataWrapper } from "./changes/foreign-data-wrapper.create.ts";
import { DropForeignDataWrapper } from "./changes/foreign-data-wrapper.drop.ts";
import { diffForeignDataWrappers } from "./foreign-data-wrapper.diff.ts";
import {
  ForeignDataWrapper,
  type ForeignDataWrapperProps,
} from "./foreign-data-wrapper.model.ts";

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("foreign-data-wrapper.diff", () => {
  test("create and drop", () => {
    const props: ForeignDataWrapperProps = {
      name: "fdw1",
      owner: "o1",
      handler: null,
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    };
    const fdw = new ForeignDataWrapper(props);

    const created = diffForeignDataWrappers(
      testContext,
      {},
      {
        [fdw.stableId]: fdw,
      },
    );
    expect(created[0]).toBeInstanceOf(CreateForeignDataWrapper);

    const dropped = diffForeignDataWrappers(
      testContext,
      {
        [fdw.stableId]: fdw,
      },
      {},
    );
    expect(dropped[0]).toBeInstanceOf(DropForeignDataWrapper);
  });

  test("alter: owner change", () => {
    const main = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: null,
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });
    const branch = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o2",
      handler: null,
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const changes = diffForeignDataWrappers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterForeignDataWrapperChangeOwner),
    ).toBe(true);
  });

  test("alter: options changes", () => {
    const main = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: null,
      validator: null,
      options: ["host", "localhost"],
      comment: null,
      privileges: [],
    });
    const branch = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: null,
      validator: null,
      options: ["host", "newhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const changes = diffForeignDataWrappers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const optionsChange = changes.find(
      (c) => c instanceof AlterForeignDataWrapperSetOptions,
    ) as AlterForeignDataWrapperSetOptions | undefined;
    expect(optionsChange).toBeDefined();
    expect(optionsChange?.options.length).toBeGreaterThan(0);
  });

  test("handler change triggers drop and create", () => {
    const main = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: "public.old_handler()",
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });
    const branch = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: "public.new_handler()",
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const changes = diffForeignDataWrappers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    // Handler change should trigger drop + create
    expect(changes.some((c) => c instanceof DropForeignDataWrapper)).toBe(true);
    expect(changes.some((c) => c instanceof CreateForeignDataWrapper)).toBe(
      true,
    );
  });

  test("validator change triggers drop and create", () => {
    const main = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: null,
      validator: "public.old_validator()",
      options: null,
      comment: null,
      privileges: [],
    });
    const branch = new ForeignDataWrapper({
      name: "fdw1",
      owner: "o1",
      handler: null,
      validator: "public.new_validator()",
      options: null,
      comment: null,
      privileges: [],
    });

    const changes = diffForeignDataWrappers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    // Validator change should trigger drop + create
    expect(changes.some((c) => c instanceof DropForeignDataWrapper)).toBe(true);
    expect(changes.some((c) => c instanceof CreateForeignDataWrapper)).toBe(
      true,
    );
  });
});

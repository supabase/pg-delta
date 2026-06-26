import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
} from "./changes/enum.alter.ts";
import {
  CreateCommentOnEnum,
  DropCommentOnEnum,
} from "./changes/enum.comment.ts";
import { CreateEnum } from "./changes/enum.create.ts";
import { DropEnum } from "./changes/enum.drop.ts";
import {
  GrantEnumPrivileges,
  RevokeEnumPrivileges,
  RevokeGrantOptionEnumPrivileges,
} from "./changes/enum.privilege.ts";
import { diffEnums } from "./enum.diff.ts";
import { Enum, type EnumProps } from "./enum.model.ts";

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

function testEnum(labels: string[]) {
  return new Enum({
    schema: "public",
    name: "e1",
    owner: "o1",
    labels: labels.map((label, index) => ({
      label,
      sort_order: index + 1,
    })),
    comment: null,
    privileges: [],
  });
}

describe.concurrent("enum.diff", () => {
  test("create and drop", () => {
    const props: EnumProps = {
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
      ],
      comment: null,
      privileges: [],
    };
    const e = new Enum(props);

    const created = diffEnums(testContext, {}, { [e.stableId]: e });
    expect(created[0]).toBeInstanceOf(CreateEnum);

    const dropped = diffEnums(testContext, { [e.stableId]: e }, {});
    expect(dropped[0]).toBeInstanceOf(DropEnum);
  });

  test("alter: owner change and add value positioning", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o2",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterEnumChangeOwner)).toBe(true);
    const add = changes.find((c) => c instanceof AlterEnumAddValue) as
      | AlterEnumAddValue
      | undefined;
    expect(add).toBeDefined();
  });

  test("add value at beginning (BEFORE first)", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const add = changes.find((c) => c instanceof AlterEnumAddValue) as
      | AlterEnumAddValue
      | undefined;
    expect(add).toBeDefined();
    expect(add?.position?.before).toBe("b");
    expect(add?.position?.after).toBeUndefined();
  });

  test("add multiple leading values from right to left using existing anchors", () => {
    const main = testEnum(["c"]);
    const branch = testEnum(["a", "b", "c"]);

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const adds = changes.filter(
      (c): c is AlterEnumAddValue => c instanceof AlterEnumAddValue,
    );

    expect(
      adds.map((add) => ({
        newValue: add.newValue,
        position: add.position,
      })),
    ).toEqual([
      { newValue: "b", position: { before: "c" } },
      { newValue: "a", position: { before: "b" } },
    ]);
  });

  test("add value in middle (AFTER previous)", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const add = changes.find((c) => c instanceof AlterEnumAddValue) as
      | AlterEnumAddValue
      | undefined;
    expect(add).toBeDefined();
    expect(add?.position?.after).toBe("a");
    expect(add?.position?.before).toBeUndefined();
  });

  test("add multiple middle values left to right after existing anchor", () => {
    const main = testEnum(["a", "d"]);
    const branch = testEnum(["a", "b", "c", "d"]);

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const adds = changes.filter(
      (c): c is AlterEnumAddValue => c instanceof AlterEnumAddValue,
    );

    expect(
      adds.map((add) => ({
        newValue: add.newValue,
        position: add.position,
      })),
    ).toEqual([
      { newValue: "b", position: { after: "a" } },
      { newValue: "c", position: { after: "b" } },
    ]);
  });

  test("add value at end (AFTER last)", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
      ],
      comment: null,
      privileges: [],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const add = changes.find((c) => c instanceof AlterEnumAddValue) as
      | AlterEnumAddValue
      | undefined;
    expect(add).toBeDefined();
    expect(add?.position?.after).toBe("b");
    expect(add?.position?.before).toBeUndefined();
  });

  test("create with comment emits CreateCommentOnEnum", () => {
    const e = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: "my enum",
      privileges: [],
    });
    const changes = diffEnums(testContext, {}, { [e.stableId]: e });
    expect(changes[0]).toBeInstanceOf(CreateEnum);
    expect(changes.some((c) => c instanceof CreateCommentOnEnum)).toBe(true);
  });

  test("create with privileges that trigger revoke grant option", () => {
    const dpState = new DefaultPrivilegeState({});
    dpState.applyGrant("postgres", "T", null, "role_downgrade", [
      { privilege: "USAGE", grantable: true },
    ]);
    const ctx = { ...testContext, defaultPrivilegeState: dpState };
    const e = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: null,
      privileges: [
        { grantee: "role_downgrade", privilege: "USAGE", grantable: false },
      ],
    });
    const changes = diffEnums(ctx, {}, { [e.stableId]: e });
    expect(changes[0]).toBeInstanceOf(CreateEnum);
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionEnumPrivileges),
    ).toBe(true);
  });

  test("alter with removed labels triggers drop and recreate", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
        { label: "c", sort_order: 3 },
      ],
      comment: null,
      privileges: [],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "c", sort_order: 2 },
      ],
      comment: null,
      privileges: [],
    });
    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropEnum);
    expect(changes[1]).toBeInstanceOf(CreateEnum);
  });

  test("alter with removed labels preserves comment and privileges", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [
        { label: "a", sort_order: 1 },
        { label: "b", sort_order: 2 },
      ],
      comment: "my enum",
      privileges: [{ grantee: "role_a", privilege: "USAGE", grantable: false }],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: "my enum",
      privileges: [{ grantee: "role_a", privilege: "USAGE", grantable: false }],
    });
    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropEnum);
    expect(changes[1]).toBeInstanceOf(CreateEnum);
    expect(changes.some((c) => c instanceof CreateCommentOnEnum)).toBe(true);
    expect(changes.some((c) => c instanceof GrantEnumPrivileges)).toBe(true);
  });

  test("alter comment emits create and drop comment", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: null,
      privileges: [],
    });
    const withComment = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: "my enum",
      privileges: [],
    });

    const addComment = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );
    expect(addComment.some((c) => c instanceof CreateCommentOnEnum)).toBe(true);

    const dropComment = diffEnums(
      testContext,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );
    expect(dropComment.some((c) => c instanceof DropCommentOnEnum)).toBe(true);
  });

  test("alter privileges emits grant, revoke, and revoke grant option", () => {
    const main = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: null,
      privileges: [
        { grantee: "role_a", privilege: "USAGE", grantable: false },
        { grantee: "role_b", privilege: "USAGE", grantable: true },
        { grantee: "role_removed", privilege: "USAGE", grantable: false },
      ],
    });
    const branch = new Enum({
      schema: "public",
      name: "e1",
      owner: "o1",
      labels: [{ label: "a", sort_order: 1 }],
      comment: null,
      privileges: [
        { grantee: "role_a", privilege: "USAGE", grantable: true },
        { grantee: "role_b", privilege: "USAGE", grantable: false },
        { grantee: "role_new", privilege: "USAGE", grantable: false },
      ],
    });

    const changes = diffEnums(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof GrantEnumPrivileges)).toBe(true);
    expect(changes.some((c) => c instanceof RevokeEnumPrivileges)).toBe(true);
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionEnumPrivileges),
    ).toBe(true);
  });
});

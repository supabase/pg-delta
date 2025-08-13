import { describe, expect, test } from "vitest";
import {
  AlterExtensionChangeOwner,
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
  ReplaceExtension,
} from "./changes/extension.alter.ts";
import { CreateExtension } from "./changes/extension.create.ts";
import { DropExtension } from "./changes/extension.drop.ts";
import { diffExtensions } from "./extension.diff.ts";
import { Extension, type ExtensionProps } from "./extension.model.ts";

const base: ExtensionProps = {
  name: "pgcrypto",
  schema: "public",
  relocatable: true,
  version: "1.0",
  owner: "o1",
};

describe.concurrent("extension.diff", () => {
  test("create and drop", () => {
    const e = new Extension(base);
    const created = diffExtensions({}, { [e.stableId]: e });
    expect(created[0]).toBeInstanceOf(CreateExtension);
    const dropped = diffExtensions({ [e.stableId]: e }, {});
    expect(dropped[0]).toBeInstanceOf(DropExtension);
  });

  test("alter: version, schema, owner", () => {
    const main = new Extension(base);
    const branch = new Extension({
      ...base,
      version: "1.1",
      schema: "utils",
      owner: "o2",
    });
    const changes = diffExtensions(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterExtensionUpdateVersion)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterExtensionSetSchema)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterExtensionChangeOwner)).toBe(
      true,
    );
  });

  test("replace when not relocatable", () => {
    const main = new Extension({ ...base, relocatable: false });
    const branch = new Extension({
      ...base,
      relocatable: false,
      schema: "utils",
    });
    const changes = diffExtensions(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceExtension);
  });
});

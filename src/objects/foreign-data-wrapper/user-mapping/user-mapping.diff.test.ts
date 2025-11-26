import { describe, expect, test } from "vitest";
import { AlterUserMappingSetOptions } from "./changes/user-mapping.alter.ts";
import { CreateUserMapping } from "./changes/user-mapping.create.ts";
import { DropUserMapping } from "./changes/user-mapping.drop.ts";
import { diffUserMappings } from "./user-mapping.diff.ts";
import { UserMapping, type UserMappingProps } from "./user-mapping.model.ts";

describe.concurrent("user-mapping.diff", () => {
  test("create and drop", () => {
    const props: UserMappingProps = {
      user: "u1",
      server: "srv1",
      options: null,
    };
    const mapping = new UserMapping(props);

    const created = diffUserMappings({}, { [mapping.stableId]: mapping });
    expect(created[0]).toBeInstanceOf(CreateUserMapping);

    const dropped = diffUserMappings({ [mapping.stableId]: mapping }, {});
    expect(dropped[0]).toBeInstanceOf(DropUserMapping);
  });

  test("alter: options changes", () => {
    // With the simplified approach, SET actions are filtered out, but ADD actions are not.
    // Adding a new option (password) should generate an ALTER statement.
    const main = new UserMapping({
      user: "u1",
      server: "srv1",
      options: ["user", "remote_user"],
    });
    const branch = new UserMapping({
      user: "u1",
      server: "srv1",
      options: ["user", "remote_user", "password", "secret"],
    });

    const changes = diffUserMappings(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    // ADD actions are not filtered, so ALTER should be generated
    const optionsChange = changes.find(
      (c) => c instanceof AlterUserMappingSetOptions,
    ) as AlterUserMappingSetOptions | undefined;
    expect(optionsChange).toBeDefined();
    expect(optionsChange?.options).toEqual([
      { action: "ADD", option: "password", value: "secret" },
    ]);
  });

  test("create with PUBLIC user", () => {
    const mapping = new UserMapping({
      user: "PUBLIC",
      server: "srv1",
      options: null,
    });

    const created = diffUserMappings({}, { [mapping.stableId]: mapping });
    expect(created[0]).toBeInstanceOf(CreateUserMapping);
    expect((created[0] as CreateUserMapping).userMapping.user).toBe("PUBLIC");
  });

  test("create with CURRENT_USER", () => {
    const mapping = new UserMapping({
      user: "CURRENT_USER",
      server: "srv1",
      options: null,
    });

    const created = diffUserMappings({}, { [mapping.stableId]: mapping });
    expect(created[0]).toBeInstanceOf(CreateUserMapping);
    expect((created[0] as CreateUserMapping).userMapping.user).toBe(
      "CURRENT_USER",
    );
  });
});

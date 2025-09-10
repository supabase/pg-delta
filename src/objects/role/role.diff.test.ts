import { describe, expect, test } from "vitest";
import { AlterRoleSetOptions, ReplaceRole } from "./changes/role.alter.ts";
import { CreateRole } from "./changes/role.create.ts";
import { DropRole } from "./changes/role.drop.ts";
import { diffRoles } from "./role.diff.ts";
import { Role, type RoleProps } from "./role.model.ts";

const base: RoleProps = {
  role_name: "r1",
  is_superuser: false,
  can_inherit: true,
  can_create_roles: false,
  can_create_databases: false,
  can_login: true,
  can_replicate: false,
  connection_limit: null,
  can_bypass_rls: false,
  config: null,
};

describe.concurrent("role.diff", () => {
  test("create and drop", () => {
    const r = new Role(base);
    const created = diffRoles({}, { [r.stableId]: r });
    expect(created[0]).toBeInstanceOf(CreateRole);

    const dropped = diffRoles({ [r.stableId]: r }, {});
    expect(dropped[0]).toBeInstanceOf(DropRole);
  });

  test("alter on flag change", () => {
    const main = new Role(base);
    const branch = new Role({ ...base, can_login: false });
    const changes = diffRoles(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRoleSetOptions);
  });

  test("replace on config change", () => {
    const main = new Role(base);
    const branch = new Role({ ...base, config: ["search_path=schema1"] });
    const changes = diffRoles(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceRole);
  });
});

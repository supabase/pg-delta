import { describe, expect, test } from "vitest";
import { Role } from "../role.model.ts";
import { DropRole } from "./role.drop.ts";

describe("role", () => {
  test("drop", () => {
    const role = new Role({
      role_name: "test_role",
      is_superuser: false,
      can_inherit: true,
      can_create_roles: false,
      can_create_databases: false,
      can_login: true,
      can_replicate: false,
      connection_limit: null,
      can_bypass_rls: false,
      config: null,
      comment: null,
      members: [],
    });

    const change = new DropRole({
      role,
    });

    expect(change.serialize()).toBe("DROP ROLE test_role");
  });
});

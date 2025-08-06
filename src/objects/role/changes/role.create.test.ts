import { describe, expect, test } from "vitest";
import { Role } from "../role.model.ts";
import { CreateRole } from "./role.create.ts";

describe("role", () => {
  test("create", () => {
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
    });

    const change = new CreateRole({
      role,
    });

    expect(change.serialize()).toBe("CREATE ROLE test_role LOGIN");
  });
});

import { describe, expect, test } from "vitest";
import { Role } from "../role.model.ts";
import { CreateRole } from "./role.create.ts";

describe("role", () => {
  test("create minimal (omit defaults)", () => {
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

    expect(change.serialize()).toBe("CREATE ROLE test_role WITH LOGIN");
  });

  test("create with all options (non-defaults only)", () => {
    const role = new Role({
      role_name: "r_all",
      is_superuser: true,
      can_inherit: false,
      can_create_roles: true,
      can_create_databases: true,
      can_login: true,
      can_replicate: true,
      connection_limit: 5,
      can_bypass_rls: true,
      config: null,
    });

    const change = new CreateRole({ role });
    expect(change.serialize()).toBe(
      "CREATE ROLE r_all WITH SUPERUSER CREATEDB CREATEROLE NOINHERIT LOGIN REPLICATION BYPASSRLS CONNECTION LIMIT 5",
    );
  });
});

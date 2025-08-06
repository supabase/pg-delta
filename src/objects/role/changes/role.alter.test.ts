import { describe, expect, test } from "vitest";
import { Role } from "../role.model.ts";
import { ReplaceRole } from "./role.alter.ts";

describe.concurrent("role", () => {
  describe("alter", () => {
    test("replace role", () => {
      const main = new Role({
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
      const branch = new Role({
        role_name: "test_role",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: true,
        can_create_databases: false,
        can_login: true,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
      });

      const change = new ReplaceRole({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP ROLE test_role;\nCREATE ROLE test_role LOGIN CREATEROLE",
      );
    });
  });
});

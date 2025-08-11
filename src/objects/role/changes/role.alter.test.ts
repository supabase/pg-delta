import { describe, expect, test } from "vitest";
import { Role, type RoleProps } from "../role.model.ts";
import { ReplaceRole } from "./role.alter.ts";

describe.concurrent("role", () => {
  describe("alter", () => {
    test("replace role", () => {
      const props: Omit<RoleProps, "can_create_roles"> = {
        role_name: "test_role",
        is_superuser: false,
        can_inherit: true,
        can_create_databases: false,
        can_login: true,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
      };
      const main = new Role({
        ...props,
        can_create_roles: false,
      });
      const branch = new Role({
        ...props,
        can_create_roles: true,
      });

      const change = new ReplaceRole({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP ROLE test_role;\nCREATE ROLE test_role WITH CREATEROLE LOGIN",
      );
    });
  });
});

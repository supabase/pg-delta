import { describe, expect, test } from "vitest";
import { Role, type RoleProps } from "../role.model.ts";
import { AlterRoleSetOptions } from "./role.alter.ts";

describe.concurrent("role", () => {
  describe("alter", () => {
    test("alter SUPERUSER", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, is_superuser: true });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH SUPERUSER");
    });

    test("alter NOSUPERUSER", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: true,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, is_superuser: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOSUPERUSER");
    });

    test("alter NOCREATEDB", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: true,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_create_databases: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOCREATEDB");
    });

    test("alter NOCREATEROLE", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: true,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_create_roles: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOCREATEROLE");
    });

    test("alter INHERIT", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: false,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_inherit: true });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH INHERIT");
    });

    test("alter LOGIN", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_login: true });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH LOGIN");
    });

    test("alter NOREPLICATION", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: true,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_replicate: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOREPLICATION");
    });

    test("alter NOBYPASSRLS", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: true,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_bypass_rls: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOBYPASSRLS");
    });

    test("alter CREATEROLE", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_create_roles: true });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH CREATEROLE");
    });

    test("alter NOINHERIT", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_inherit: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOINHERIT");
    });

    test("alter NOLOGIN", () => {
      const main = new Role({
        role_name: "r",
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
      });
      const branch = new Role({ ...main, can_login: false });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOLOGIN");
    });

    test("alter REPLICATION", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_replicate: true });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH REPLICATION");
    });

    test("alter BYPASSRLS", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({ ...main, can_bypass_rls: true });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe("ALTER ROLE r WITH BYPASSRLS");
    });

    test("alter multiple options ordering", () => {
      const main = new Role({
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
      });
      const branch = new Role({
        ...main,
        is_superuser: true,
        can_create_databases: true,
        can_create_roles: true,
        can_inherit: false,
        can_login: true,
        can_replicate: true,
        can_bypass_rls: true,
        connection_limit: 10,
      });
      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER ROLE r WITH SUPERUSER CREATEDB CREATEROLE NOINHERIT LOGIN REPLICATION BYPASSRLS CONNECTION LIMIT 10",
      );
    });
    test("alter flags and connection limit", () => {
      const props: Omit<
        RoleProps,
        "can_create_databases" | "connection_limit"
      > = {
        role_name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_login: false,
        can_replicate: false,
        can_bypass_rls: false,
        config: null,
        comment: null,
      };
      const main = new Role({
        ...props,
        can_create_databases: false,
        connection_limit: null,
      });
      const branch = new Role({
        ...props,
        can_create_databases: true,
        connection_limit: 3,
      });

      const change = new AlterRoleSetOptions({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER ROLE r WITH CREATEDB CONNECTION LIMIT 3",
      );
    });
  });
});

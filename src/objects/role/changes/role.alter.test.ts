import { describe, expect, test } from "vitest";
import { Role, type RoleProps } from "../role.model.ts";
import { AlterRoleSetOptions } from "./role.alter.ts";

describe.concurrent("role", () => {
  describe("alter", () => {
    test("alter SUPERUSER", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["SUPERUSER"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH SUPERUSER");
    });

    test("alter NOSUPERUSER", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOSUPERUSER"],
      });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOSUPERUSER");
    });

    test("alter NOCREATEDB", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["NOCREATEDB"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOCREATEDB");
    });

    test("alter NOCREATEROLE", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOCREATEROLE"],
      });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOCREATEROLE");
    });

    test("alter INHERIT", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["INHERIT"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH INHERIT");
    });

    test("alter LOGIN", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["LOGIN"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH LOGIN");
    });

    test("alter NOREPLICATION", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOREPLICATION"],
      });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOREPLICATION");
    });

    test("alter NOBYPASSRLS", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOBYPASSRLS"],
      });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOBYPASSRLS");
    });

    test("alter CREATEROLE", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["CREATEROLE"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH CREATEROLE");
    });

    test("alter NOINHERIT", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["NOINHERIT"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOINHERIT");
    });

    test("alter NOLOGIN", () => {
      const role = new Role({
        name: "r",
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
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["NOLOGIN"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOLOGIN");
    });

    test("alter REPLICATION", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["REPLICATION"],
      });
      expect(change.serialize()).toBe("ALTER ROLE r WITH REPLICATION");
    });

    test("alter BYPASSRLS", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["BYPASSRLS"] });
      expect(change.serialize()).toBe("ALTER ROLE r WITH BYPASSRLS");
    });

    test("alter multiple options ordering", () => {
      const role = new Role({
        name: "r",
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
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: [
          "SUPERUSER",
          "CREATEDB",
          "CREATEROLE",
          "NOINHERIT",
          "LOGIN",
          "REPLICATION",
          "BYPASSRLS",
          "CONNECTION LIMIT 10",
        ],
      });
      expect(change.serialize()).toBe(
        "ALTER ROLE r WITH SUPERUSER CREATEDB CREATEROLE NOINHERIT LOGIN REPLICATION BYPASSRLS CONNECTION LIMIT 10",
      );
    });
    test("alter flags and connection limit", () => {
      const props: Omit<
        RoleProps,
        "can_create_databases" | "connection_limit"
      > = {
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_login: false,
        can_replicate: false,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      };
      const role = new Role({
        ...props,
        can_create_databases: false,
        connection_limit: null,
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["CREATEDB", "CONNECTION LIMIT 3"],
      });
      expect(change.serialize()).toBe(
        "ALTER ROLE r WITH CREATEDB CONNECTION LIMIT 3",
      );
    });
  });
});

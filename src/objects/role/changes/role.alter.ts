import { Change } from "../../base.change.ts";
import { formatConfigValue } from "../../procedure/utils.ts";
import type { Role } from "../role.model.ts";

/**
 * Alter a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterrole.html
 *
 * Synopsis
 * ```sql
 * ALTER ROLE role_name [ WITH ] option [ ... ]
 * where option can be:
 *     SUPERUSER | NOSUPERUSER
 *     | CREATEDB | NOCREATEDB
 *     | CREATEROLE | NOCREATEROLE
 *     | INHERIT | NOINHERIT
 *     | LOGIN | NOLOGIN
 *     | REPLICATION | NOREPLICATION
 *     | BYPASSRLS | NOBYPASSRLS
 *     | CONNECTION LIMIT connlimit
 *     | [ ENCRYPTED ] PASSWORD 'password' | PASSWORD NULL
 *     | VALID UNTIL 'timestamp'
 *     | IN ROLE role_name [, ...]
 *     | IN GROUP role_name [, ...]
 *     | ROLE role_name [, ...]
 *     | ADMIN role_name [, ...]
 *     | USER role_name [, ...]
 *     | SYSID uid
 *
 * ALTER ROLE { role_specification | ALL } [ IN DATABASE database_name ] SET configuration_parameter { TO | = } { value | DEFAULT }
 * ALTER ROLE { role_specification | ALL } [ IN DATABASE database_name ] SET configuration_parameter FROM CURRENT
 * ALTER ROLE { role_specification | ALL } [ IN DATABASE database_name ] RESET configuration_parameter
 * ALTER ROLE { role_specification | ALL } [ IN DATABASE database_name ] RESET ALL
 * ```
 */

/**
 * ALTER ROLE ... WITH option [...]
 * Emits only options that differ between main and branch.
 */
export class AlterRoleSetOptions extends Change {
  public readonly main: Role;
  public readonly branch: Role;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "role" as const;

  constructor(props: { main: Role; branch: Role }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const parts: string[] = ["ALTER ROLE", this.main.role_name];
    const options: string[] = [];

    // SUPERUSER | NOSUPERUSER (default NOSUPERUSER in CREATE; here reflect change)
    if (this.main.is_superuser !== this.branch.is_superuser) {
      options.push(this.branch.is_superuser ? "SUPERUSER" : "NOSUPERUSER");
    }

    // CREATEDB | NOCREATEDB
    if (this.main.can_create_databases !== this.branch.can_create_databases) {
      options.push(
        this.branch.can_create_databases ? "CREATEDB" : "NOCREATEDB",
      );
    }

    // CREATEROLE | NOCREATEROLE
    if (this.main.can_create_roles !== this.branch.can_create_roles) {
      options.push(
        this.branch.can_create_roles ? "CREATEROLE" : "NOCREATEROLE",
      );
    }

    // INHERIT | NOINHERIT (default INHERIT)
    if (this.main.can_inherit !== this.branch.can_inherit) {
      options.push(this.branch.can_inherit ? "INHERIT" : "NOINHERIT");
    }

    // LOGIN | NOLOGIN (default NOLOGIN)
    if (this.main.can_login !== this.branch.can_login) {
      options.push(this.branch.can_login ? "LOGIN" : "NOLOGIN");
    }

    // REPLICATION | NOREPLICATION
    if (this.main.can_replicate !== this.branch.can_replicate) {
      options.push(this.branch.can_replicate ? "REPLICATION" : "NOREPLICATION");
    }

    // BYPASSRLS | NOBYPASSRLS
    if (this.main.can_bypass_rls !== this.branch.can_bypass_rls) {
      options.push(this.branch.can_bypass_rls ? "BYPASSRLS" : "NOBYPASSRLS");
    }

    // CONNECTION LIMIT connlimit (null treated as no change sentinel in model)
    if (this.main.connection_limit !== this.branch.connection_limit) {
      options.push(`CONNECTION LIMIT ${this.branch.connection_limit}`);
    }

    return [...parts, "WITH", options.join(" ")].join(" ");
  }
}

/**
 * ALTER ROLE ... SET/RESET configuration_parameter (single statement)
 * Represents one action: SET key TO value, RESET key, or RESET ALL.
 */
export class AlterRoleSetConfig extends Change {
  public readonly role: Role;
  public readonly action: "set" | "reset" | "reset_all";
  public readonly key?: string;
  public readonly value?: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "role" as const;

  constructor(props: { role: Role; action: "set"; key: string; value: string });
  constructor(props: { role: Role; action: "reset"; key: string });
  constructor(props: { role: Role; action: "reset_all" });
  constructor(props: {
    role: Role;
    action: "set" | "reset" | "reset_all";
    key?: string;
    value?: string;
  }) {
    super();
    this.role = props.role;
    this.action = props.action;
    this.key = props.key;
    this.value = props.value;
  }

  get dependencies() {
    return [this.role.stableId];
  }

  serialize(): string {
    const head = ["ALTER ROLE", this.role.role_name].join(" ");
    if (this.action === "reset_all") {
      return `${head} RESET ALL`;
    }
    if (this.action === "reset") {
      return `${head} RESET ${this.key}`;
    }
    const formatted = formatConfigValue(
      this.key as string,
      this.value as string,
    );
    return `${head} SET ${this.key} TO ${formatted}`;
  }
}

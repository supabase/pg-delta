import { formatConfigValue } from "../../procedure/utils.ts";
import type { Role } from "../role.model.ts";
import { AlterRoleChange } from "./role.base.ts";

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

export type AlterRole = AlterRoleSetConfig | AlterRoleSetOptions;

/**
 * ALTER ROLE ... WITH option [...]
 * Emits only options that differ between main and branch.
 */
export class AlterRoleSetOptions extends AlterRoleChange {
  public readonly role: Role;
  public readonly options: string[];
  public readonly scope = "object" as const;

  constructor(props: { role: Role; options: string[] }) {
    super();
    this.role = props.role;
    this.options = props.options;
  }

  get requires() {
    return [this.role.stableId];
  }

  serialize(): string {
    const parts: string[] = ["ALTER ROLE", this.role.name];
    return [...parts, "WITH", this.options.join(" ")].join(" ");
  }
}

/**
 * ALTER ROLE ... SET/RESET configuration_parameter (single statement)
 * Represents one action: SET key TO value, RESET key, or RESET ALL.
 */
export class AlterRoleSetConfig extends AlterRoleChange {
  public readonly role: Role;
  public readonly action: "set" | "reset" | "reset_all";
  public readonly key?: string;
  public readonly value?: string;
  public readonly scope = "object" as const;

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

  get requires() {
    return [this.role.stableId];
  }

  serialize(): string {
    const head = ["ALTER ROLE", this.role.name].join(" ");
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

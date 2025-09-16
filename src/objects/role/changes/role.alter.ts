import { AlterChange, ReplaceChange } from "../../base.change.ts";
import type { Role } from "../role.model.ts";
import { CreateRole } from "./role.create.ts";
import { DropRole } from "./role.drop.ts";

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
 * ```
 */

/**
 * ALTER ROLE ... WITH option [...]
 * Emits only options that differ between main and branch.
 */
export class AlterRoleSetOptions extends AlterChange {
  public readonly main: Role;
  public readonly branch: Role;

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
 * Replace a role by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER ROLE change.
 */
export class ReplaceRole extends ReplaceChange {
  public readonly main: Role;
  public readonly branch: Role;

  constructor(props: { main: Role; branch: Role }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const dropChange = new DropRole({ role: this.main });
    const createChange = new CreateRole({ role: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}

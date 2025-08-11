import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

/**
 * Create a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-createrole.html
 *
 * Synopsis
 * ```sql
 * CREATE ROLE name [ [ WITH ] option [ ... ] ]
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
export class CreateRole extends CreateChange {
  public readonly role: Role;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  serialize(): string {
    const parts: string[] = ["CREATE ROLE"];

    // Add role name
    parts.push(quoteIdentifier(this.role.role_name));

    // Add options (only non-default values)
    const options: string[] = [];

    // SUPERUSER (default is NOSUPERUSER)
    if (this.role.is_superuser) {
      options.push("SUPERUSER");
    }

    // CREATEDB (default is NOCREATEDB)
    if (this.role.can_create_databases) {
      options.push("CREATEDB");
    }

    // CREATEROLE (default is NOCREATEROLE)
    if (this.role.can_create_roles) {
      options.push("CREATEROLE");
    }

    // INHERIT (default is INHERIT, so only print if false)
    if (!this.role.can_inherit) {
      options.push("NOINHERIT");
    }

    // LOGIN (default is NOLOGIN)
    if (this.role.can_login) {
      options.push("LOGIN");
    }

    // REPLICATION (default is NOREPLICATION)
    if (this.role.can_replicate) {
      options.push("REPLICATION");
    }

    // BYPASSRLS (default is NOBYPASSRLS)
    if (this.role.can_bypass_rls) {
      options.push("BYPASSRLS");
    }

    // CONNECTION LIMIT
    if (this.role.connection_limit !== null) {
      options.push(`CONNECTION LIMIT ${this.role.connection_limit}`);
    }

    if (options.length > 0) {
      parts.push("WITH", options.join(" "));
    }

    return parts.join(" ");
  }
}

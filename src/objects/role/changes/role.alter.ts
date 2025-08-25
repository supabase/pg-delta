import { ReplaceChange } from "../../base.change.ts";
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
export type AlterRole = never; // No alterable properties for roles

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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropRole({ role: this.main });
    const createChange = new CreateRole({ role: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}

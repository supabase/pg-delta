import { DropChange } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

/**
 * Drop a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-droprole.html
 *
 * Synopsis
 * ```sql
 * DROP ROLE [ IF EXISTS ] name [, ...]
 * ```
 */
export class DropRole extends DropChange {
  public readonly role: Role;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get stableId(): string {
    return `${this.role.stableId}`;
  }

  serialize(): string {
    return ["DROP ROLE", this.role.role_name].join(" ");
  }
}
